# 장애 대응 매뉴얼

## 문서 정보

| 항목 | 내용 |
|------|------|
| **작성일** | 2026-03-01 |
| **기반 데이터** | k6 부하 테스트 결과 (Small/Medium 스펙 각 4개 시나리오) + 코드 분석 |
| **적용 대상** | 콘서트 예약 서비스 (NestJS + MySQL + Redis + Kafka) |

---

## 1. 부하 테스트 기반 병목 분석

### 1-1. 테스트로 확인된 병목 포인트

| 시나리오 | 관측 현상 | 원인 |
|---------|---------|------|
| Reservation Stress | `http_req_failed` 49% | 좌석 소진 후 409 Conflict 대량 발생 — 분산락 정상 동작 |
| Payment Load | `http_req_failed` 44% | 결제 완료 예약에 반복 결제 시도 → 4xx 반환 — 중복 방지 정상 |
| Queue Spike | 응답 avg 6ms (Small) vs 2.8ms (Medium) | CPU 0.5 vCPU 제약 시 이벤트 루프 지연 |
| Concert Endurance | 캐시 Hit Rate 100% | 첫 요청 이후 DB 미접근, 정상 |

### 1-2. 코드 분석으로 발견된 잠재 병목

| 항목 | 현재 설정 | 위험도 | 설명 |
|------|---------|--------|------|
| DB 커넥션 풀 | TypeORM 기본값 (명시적 설정 없음) | 🔴 높음 | 기본값은 10개로 50 VU 동시 예약 시 고갈 위험 |
| 분산락 TTL/Wait | TTL 5s / Wait 3s | 🟡 중간 | 경합 시 최대 3초 대기, 커넥션 점유 지속 |
| Kafka 에러 처리 | 전송 실패 시 `throw error` | 🔴 높음 | Kafka 장애 = 결제 전체 실패로 직결 |
| Kafka Consumer DLQ | 미적용 (로그만 기록) | 🔴 높음 | 예약 만료 이벤트 손실 시 좌석 영구 점유 |
| Queue 활성화 주기 | Polling 5초 간격 | 🟡 중간 | 최대 5초 대기, 고부하 시 DB 쿼리 지연 가능 |
| 예약 만료 Consumer | `setTimeout` 블로킹 | 🟡 중간 | 이벤트 루프 블로킹, 대량 메시지 처리 시 누적 |

---

## 2. 장애 대응 매뉴얼 — Part A

> **완벽히 개선이 어려운 포인트**: 구조적 특성상 100% 제거는 어렵지만 완화 가능한 장애

---

### A-1. 분산락 경합 → DB 커넥션 점유

#### 현상 및 원인

```
티켓 오픈 시 다수 VU가 동일 좌석 예약 시도
  → Redis 분산락 대기 (최대 3초)
  → 대기 중에도 DB 커넥션 점유
  → 커넥션 풀 고갈 → 신규 요청 타임아웃
```

**코드 위치**: [src/reservation/reservation.service.ts](../src/reservation/reservation.service.ts)

현재 동작:
```typescript
// 분산락 획득 → 트랜잭션 실행 → 해제
await this.distributedLockService.withLock(`seat:${seat.seatId}`, async () => {
  return this.dataSource.transaction(async (manager) => { ... });
}, { ttlMs: 5000, waitMs: 3000, retryIntervalMs: 50 });
```

#### 탐지 방법

- DB 커넥션 사용률 > 80% 알림 (Prometheus `mysql_connection_pool_active`)
- `http_req_duration p95 > 1000ms` 알림
- 로그에서 `DistributedLockAcquisitionError` 빈도 증가 확인

#### 즉시 대응 (운영 중 장애 시)

1. **트래픽 제한**: nginx rate limit 또는 API GW throttling 즉시 적용
   ```bash
   # nginx rate limit 임시 강화 (초당 요청 제한)
   nginx -s reload  # 설정 변경 후 적용
   ```

2. **대기열 활성 토큰 수 축소**: `MAX_ACTIVE_TOKENS` 50 → 20으로 핫픽스 배포

3. **커넥션 풀 모니터링**: 현재 사용 커넥션 수 실시간 확인
   ```sql
   SHOW STATUS LIKE 'Threads_connected';
   SHOW STATUS LIKE 'Connection_errors_max_connections';
   ```

#### 근본 개선 방안

```typescript
// TypeORM 커넥션 풀 명시적 설정
// src/database/database.config.ts
TypeOrmModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    type: 'mysql',
    ...configService.get<DatabaseConfig>('database'),
    extra: {
      connectionLimit: 30,       // 기본 10 → 30으로 증설
      waitForConnections: true,
      queueLimit: 100,
      connectTimeout: 5000,
    },
  }),
});
```

```typescript
// 분산락 Wait 시간 단축으로 빠른 실패 처리
// src/reservation/reservation.service.ts
await this.distributedLockService.withLock(
  `seat:${seat.seatId}`,
  async () => { ... },
  {
    ttlMs: 3000,           // 5000 → 3000
    waitMs: 1500,          // 3000 → 1500 (빠른 실패)
    retryIntervalMs: 30,   // 50 → 30
  }
);
```

#### 완화 한계

> 분산락은 데이터 정합성을 위한 필수 메커니즘으로 **완전 제거 불가**.
> 커넥션 풀 증설 + Wait 단축으로 고갈 빈도를 낮출 수 있지만,
> 트래픽이 물리적 한계를 초과하면 결국 요청 거부 필요.
> 장기적으로는 수평 스케일 아웃으로 대응.

---

### A-2. 좌석 소진 후 大量 409 응답 → 고 에러율 표시

#### 현상 및 원인

```
인기 공연 좌석이 소진되어도 사용자 예약 요청 지속
  → 전체 요청의 약 50%가 409 Conflict 반환
  → k6 기본 집계: 4xx = http_req_failed
  → 모니터링 상 에러율 급등 → 오탐(False Positive) 발생
```

**부하 테스트 데이터**: Scenario 2 Small/Medium 모두 `http_req_failed` 49%

#### 탐지 방법

- 409 응답 코드 비율 모니터링 (5xx와 분리)
- `reservation_conflict` custom metric으로 비즈니스 거부 건수 추적
- 로그에서 `이미 예약된 좌석입니다` 메시지 급증 감지

#### 즉시 대응

1. **알림 기준 분리**: 5xx 에러율 알림과 4xx 비율 알림을 별도로 운영
   ```yaml
   # Prometheus Alert Rule — 5xx만 장애로 판단
   - alert: HighServerErrorRate
     expr: rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m]) > 0.01

   # 409는 별도 비즈니스 알림
   - alert: SeatConflictRateHigh
     expr: rate(http_requests_total{status="409"}[1m]) > 50
     annotations:
       summary: "좌석 경합 급증 — 잔여 좌석 확인 필요"
   ```

2. **좌석 현황 즉시 확인**
   ```sql
   SELECT status, COUNT(*) FROM reservation
   WHERE schedule_id = 'affected_schedule'
   GROUP BY status;
   ```

#### 근본 개선 방안

k6 threshold 수정 — 비즈니스 예외 코드 제외:
```javascript
// load-tests/02-reservation-stress-test.js
export const options = {
  thresholds: {
    // http_req_failed 대신 custom errors 메트릭 사용
    errors: ['rate<0.05'],
    // http_req_failed 제거 또는 완화
  },
};
```

API 응답에 잔여 좌석 수 포함:
```typescript
// 409 응답 시 잔여 좌석 수 반환 → 클라이언트 UX 개선
throw new ConflictException({
  message: '이미 예약된 좌석입니다.',
  remainingSeats: availableCount,
});
```

#### 완화 한계

> 좌석 소진은 **정상 비즈니스 시나리오**이므로 409 자체는 제거 불가.
> 모니터링 기준을 5xx 중심으로 재정의하고,
> 클라이언트에서 잔여 좌석 정보를 조기에 안내하는 방향으로 UX 개선이 현실적 대응.

---

### A-3. 대기열 Polling 기반 지연

#### 현상 및 원인

```
토큰 발급 → WAITING 상태
  → 5초 주기 스케줄러가 ACTIVE로 전환
  → 티켓 오픈 직후 다수 사용자가 동시에 대기
  → 스케줄러 실행 주기(5초) 동안 사용자는 WAITING 상태 유지
  → 고부하 시 DB 쿼리 지연 → 스케줄러 실행 시간 증가 → 다음 사이클 지연
```

**코드 위치**: [src/queue/queue.scheduler.ts](../src/queue/queue.scheduler.ts)

```typescript
@Interval(5_000)
async activateWaitingTokens(): Promise<void> {
  await this.queueService.activateWaitingTokens();
}
```

#### 탐지 방법

- 스케줄러 실행 시간 모니터링 (5초 초과 시 알림)
- WAITING 토큰 수 급증 감지 (`queue_waiting_tokens` Gauge)
- 사용자 CS 문의: "대기열에 있는데 오래 기다린다"

#### 즉시 대응

1. **스케줄러 주기 임시 단축** (1초로 핫픽스)
2. **MAX_ACTIVE_TOKENS 임시 증가**: 티켓 오픈 이벤트 전 사전 조정
3. **대기열 현황 직접 확인**
   ```sql
   SELECT status, COUNT(*) FROM queue_token
   WHERE created_at > NOW() - INTERVAL 10 MINUTE
   GROUP BY status;
   ```

#### 근본 개선 방안

이벤트 기반 즉시 활성화:
```typescript
// 결제 완료 또는 토큰 만료 시 즉시 활성화
// src/queue/queue.scheduler.ts
@OnEvent(PaymentCompletedEvent.EVENT_NAME)
async onPaymentCompleted(): Promise<void> {
  await this.queueService.activateWaitingTokens();
}

@OnEvent(QueueTokenExpiredEvent.EVENT_NAME)
async onTokenExpired(): Promise<void> {
  await this.queueService.activateWaitingTokens();
}
```

#### 완화 한계

> Polling을 Event-Driven으로 전환하면 지연이 크게 줄지만,
> 이벤트 유실 시 활성화가 누락될 수 있어 **Polling과 병행 운영** 필요.
> (Polling을 보조 수단으로 유지, 주기를 30초로 늘림)

---

## 3. 장애 대응 매뉴얼 — Part B

> **예측 못한 포인트**: 부하 테스트 및 코드 분석 과정에서 새롭게 발견된 장애 요인

---

### B-1. Kafka 장애 시 결제 트랜잭션 전체 실패

#### 현상 및 발견 경위

코드 분석 중 발견. Kafka Producer의 에러 처리:

```typescript
// src/infrastructure/kafka/kafka.producer.service.ts
async send(record: ProducerRecord): Promise<void> {
  try {
    await this.producer.send(record);
  } catch (error) {
    this.logger.error(`Failed to send message: ${record.topic}`, error);
    throw error; // ← Kafka 실패를 그대로 throw
  }
}
```

```typescript
// src/payment/payment.service.ts — 결제 완료 후 Kafka 발행
await this.kafkaProducer.send({ topic: 'payment.completed', ... });
// ↑ Kafka 장애 시 이 줄에서 예외 발생 → 결제 API 500 응답
// DB에는 결제가 이미 저장된 상태 → 데이터 불일치 가능
```

**예측 못했던 이유**: 부하 테스트는 정상 Kafka 환경에서 수행. Kafka 장애 시나리오는 테스트에 포함되지 않았음.

#### 장애 시나리오

```
Kafka 브로커 일시 다운 (재시작, 네트워크 단절)
  → 8회 재시도 (총 최대 ~25초 소요)
  → 재시도 실패 → throw error
  → 결제 API 500 응답
  → 단, DB에는 결제 내역 및 CONFIRMED 예약이 저장된 상태
  → 사용자: 결제 실패 메시지 수신 → 재결제 시도
  → 중복 결제 가능성
```

#### 탐지 방법

- Kafka Producer 전송 실패율 알림 (`kafka_producer_error_total > 0`)
- 결제 API 500 에러율 급등
- DB에서 CONFIRMED 예약이 있지만 알림이 미발송된 건 조회
  ```sql
  SELECT r.reservation_id, p.payment_id, p.created_at
  FROM reservation r
  JOIN payment p ON r.reservation_id = p.reservation_id
  WHERE r.status = 'CONFIRMED'
    AND p.created_at > NOW() - INTERVAL 1 HOUR
  ORDER BY p.created_at DESC;
  ```

#### 즉시 대응

1. **Kafka 브로커 상태 확인**
   ```bash
   docker logs broker1 --tail 100
   # 또는
   kafka-topics.sh --bootstrap-server localhost:9092 --list
   ```

2. **영향받은 결제 건 수동 확인 및 이벤트 재발행**
   - Kafka 복구 후 미발송 이벤트를 직접 produce
   - 랭킹, 알림 서비스에 수동으로 보상 이벤트 전달

3. **사용자 중복 결제 차단 확인**
   ```sql
   -- CONFIRMED 예약에 중복 결제 시도가 있었는지 확인
   SELECT reservation_id, COUNT(*) as attempt_count
   FROM payment
   GROUP BY reservation_id
   HAVING COUNT(*) > 1;
   ```

#### 근본 개선 방안

**Transactional Outbox 패턴** 적용:

```typescript
// 결제 트랜잭션 내에서 Kafka 직접 발행 대신 Outbox 테이블에 저장
// src/payment/payment.service.ts
return this.dataSource.transaction(async (manager) => {
  // 1. 결제 처리 (기존)
  const payment = await manager.save(Payment, { ... });

  // 2. Kafka 직접 발행 제거
  // 3. Outbox에 이벤트 저장 (DB 트랜잭션과 원자성 보장)
  await manager.save(OutboxEvent, {
    eventId: randomUUID(),
    topic: 'payment.completed',
    payload: JSON.stringify({ paymentId: payment.paymentId, ... }),
  });

  return payment;
});
// 별도 Outbox Relay 스케줄러가 Kafka로 발행 (Kafka 장애와 결제 분리)
```

**단기 완화**: Kafka 발행 실패 시 throw 대신 로그 후 처리 (비동기 발행으로 변경):
```typescript
// Kafka 장애가 결제 응답에 영향을 주지 않도록
setImmediate(() => {
  this.kafkaProducer.send({ topic: 'payment.completed', ... })
    .catch(err => this.logger.error('Kafka 발행 실패, 수동 재처리 필요', err));
});
```

---

### B-2. 예약 만료 이벤트 유실 → 좌석 영구 점유

#### 현상 및 발견 경위

코드 분석 중 발견:

```typescript
// src/reservation/reservation-expiration.consumer.ts
protected async handleMessage(payload: EachMessagePayload): Promise<void> {
  try {
    const delay = expiresAt.getTime() - now.getTime();
    await new Promise(resolve => setTimeout(resolve, delay)); // ← 블로킹
    await this.reservationService.expireReservation(...);
  } catch (error) {
    this.logger.error('Failed to process expiration message', error);
    // Dead Letter Queue 없음 → 메시지 손실 → 좌석 미해제
  }
}
```

**예측 못했던 이유**: 기능 테스트에서는 단건 만료가 정상 동작. 대량 메시지 처리 또는 Consumer 재시작 시나리오를 부하 테스트에 포함하지 않았음.

#### 장애 시나리오

```
시나리오 A: Consumer 재시작
  → in-flight 메시지의 setTimeout 취소
  → 해당 예약 만료 미처리 → 좌석 영구 HELD 상태 유지

시나리오 B: 대량 만료 메시지 폭주
  → setTimeout 누적 → 이벤트 루프 지연
  → 후속 Kafka 메시지 처리 지연 → 알림 미발송

시나리오 C: DB 장애 후 Kafka 재처리
  → expireReservation 실패 → 로그만 남기고 Commit
  → 메시지 재처리 없음 → 좌석 미해제
```

#### 탐지 방법

- HELD 상태 예약이 만료 기준 시간(5분) 초과하여 남아 있는 건 조회
  ```sql
  SELECT reservation_id, user_id, schedule_id, seat_no, status, held_expires_at
  FROM reservation
  WHERE status = 'HELD'
    AND held_expires_at < NOW()
  ORDER BY held_expires_at;
  ```

- Kafka Consumer Lag 모니터링 (`kafka_consumer_lag > 100`)

#### 즉시 대응

1. **미만료 예약 수동 처리**
   ```sql
   -- HELD 상태로 만료 시간이 지난 예약을 EXPIRED로 강제 변경
   UPDATE reservation
   SET status = 'EXPIRED'
   WHERE status = 'HELD'
     AND held_expires_at < NOW();
   ```

2. **Reservation 만료 스케줄러 강제 실행** (Polling 방식 활용)
   - `reservation.scheduler.ts`의 `@Interval(10_000)` 스케줄러가 fallback으로 동작
   - Consumer 장애 시 최대 10초 이내 스케줄러가 처리

#### 근본 개선 방안

1. **setTimeout 블로킹 제거**: 메시지를 즉시 처리하되, 만료 시각이 미래인 경우 재발행:
   ```typescript
   protected async handleMessage(payload: EachMessagePayload): Promise<void> {
     const now = new Date();
     if (expiresAt > now) {
       // 아직 만료 시각이 아님 → 지연 후 재발행 (setTimeout 블로킹 제거)
       const delay = expiresAt.getTime() - now.getTime();
       setTimeout(() => {
         this.kafkaProducer.send({ topic: 'reservation.expiration', ... });
       }, delay);
       return; // 즉시 Commit
     }
     // 만료 처리 실행
   }
   ```

2. **Dead Letter Queue(DLQ) 적용**:
   ```typescript
   // 처리 실패 시 DLQ 토픽으로 이동
   } catch (error) {
     await this.kafkaProducer.send({
       topic: 'reservation.expiration.dlq',
       messages: [{ value: payload.message.value }],
     });
   }
   ```

3. **Polling 스케줄러를 공식 Fallback으로 운영**:
   - `reservation.scheduler.ts`의 만료 처리 주기를 10초로 유지 (현행)
   - Consumer 장애 발생 시 최대 10초 이내 자동 보상

---

### B-3. DB 커넥션 풀 기본값 — 고부하 시 고갈

#### 현상 및 발견 경위

코드 분석 중 발견. TypeORM 설정에 커넥션 풀 크기가 명시되어 있지 않음:

```typescript
// src/database/database.config.ts
TypeOrmModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    type: 'mysql',
    ...configService.get<DatabaseConfig>('database'),
    // extra.connectionLimit 미설정 → mysql2 기본값 10 적용
  }),
});
```

**TypeORM + mysql2 기본 connectionLimit: 10**

Scenario 2 (50 VU 동시 예약) 상황:
- 50 VU × 분산락 대기 ~1.5s = 동시 점유 커넥션 수 = `50 × 1.5 / (avg_tx_time)` ≒ 최대 10+ 개
- 기본 10개 풀에서 고갈 위험 (테스트 환경 avg 4ms → 실 환경 더 느릴 수 있음)

**예측 못했던 이유**: 테스트 환경(로컬)에서는 응답이 빠르고(avg 4ms) 커넥션 고갈이 발생하지 않았으나, 실 서비스(네트워크 지연, 복잡한 쿼리)에서는 다를 수 있음.

#### 탐지 방법

- `SHOW STATUS LIKE 'Connection_errors_max_connections'` 값 증가
- 에러 로그: `QueryFailedError: Too many connections` 또는 `ETIMEDOUT`
- API P95 응답 시간 급격 상승 (정상 7ms → 500ms 이상)

#### 즉시 대응

1. **커넥션 수 현황 확인**
   ```sql
   SHOW PROCESSLIST;
   SHOW STATUS LIKE 'Threads_connected';
   SHOW VARIABLES LIKE 'max_connections';
   ```

2. **유휴 커넥션 강제 종료** (임시)
   ```sql
   -- 10초 이상 Sleep 상태인 커넥션 kill
   SELECT CONCAT('KILL ', id, ';')
   FROM information_schema.PROCESSLIST
   WHERE command = 'Sleep' AND time > 10;
   ```

3. **애플리케이션 재시작** (커넥션 풀 초기화)

#### 근본 개선 방안

```typescript
// src/database/database.config.ts
TypeOrmModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    type: 'mysql',
    ...configService.get<DatabaseConfig>('database'),
    extra: {
      connectionLimit: 30,       // 기본 10 → 30 (MAX_ACTIVE_TOKENS 50 고려)
      waitForConnections: true,
      queueLimit: 0,             // 무제한 대기 (대신 acquireTimeout으로 제어)
      connectTimeout: 10000,
    },
    // TypeORM 자체 커넥션 관리 옵션
    poolSize: 30,
  }),
});
```

---

### B-4. Kafka 미연결 시 이벤트 무시 (Silent Failure)

#### 현상 및 발견 경위

```typescript
// src/infrastructure/kafka/kafka.producer.service.ts
async send(record: ProducerRecord): Promise<void> {
  if (!this.isConnected) {
    this.logger.warn('Kafka Producer is not connected, skipping message send');
    return; // ← 연결 안됨 → 그냥 반환, 예외 없음
  }
  ...
}
```

개발/테스트 환경에서 Kafka 없이 앱 실행 시 이벤트가 **조용히 유실**된다. 운영 환경에서 Kafka 연결이 일시적으로 끊긴 경우에도 동일하게 발생.

**예측 못했던 이유**: 개발 편의를 위한 설계였으나, 운영 환경에서 Silent Failure로 이어질 수 있음. 부하 테스트는 정상 Kafka 환경에서 수행되어 발견하지 못함.

#### 탐지 방법

- `Kafka Producer is not connected` WARN 로그 지속 발생
- 결제 완료 후 알림이 미발송 (고객 CS 문의)
- 데이터 플랫폼에 결제 이벤트 미집계

#### 즉시 대응

1. **Kafka 연결 상태 즉시 확인**
   ```bash
   docker exec broker1 kafka-broker-api-versions.sh --bootstrap-server localhost:9092
   ```

2. **Producer 강제 재연결** (앱 재시작)

3. **이벤트 누락 구간 파악 후 수동 재발행**
   ```sql
   -- 결제 완료 후 알림이 없는 건 조회 (notification_sent 컬럼이 있는 경우)
   SELECT payment_id, user_id, created_at
   FROM payment
   WHERE created_at BETWEEN '장애_시작' AND '장애_종료'
   ORDER BY created_at;
   ```

#### 근본 개선 방안

```typescript
// 미연결 시 큐에 저장했다가 연결 복구 후 재발행
async send(record: ProducerRecord): Promise<void> {
  if (!this.isConnected) {
    this.pendingMessages.push(record); // 인메모리 큐
    this.logger.warn('Kafka 미연결, 메시지 큐에 저장. 재연결 후 발행 예정.');
    return;
  }
  ...
}

// 연결 복구 시 pendingMessages 처리
private async onConnected(): Promise<void> {
  for (const record of this.pendingMessages) {
    await this.send(record);
  }
  this.pendingMessages = [];
}
```

장기적으로는 B-1의 **Transactional Outbox 패턴**으로 해결.

---

## 4. 장애 대응 요약표

| 구분 | 장애 유형 | 탐지 지표 | 즉시 대응 | 근본 개선 | 완화 한계 |
|------|---------|---------|---------|---------|---------|
| **A-1** | 분산락 경합 → 커넥션 고갈 | `Threads_connected` 급증, P95 > 1s | Rate limit, 활성 토큰 수 축소 | 커넥션 풀 30으로 증설, Wait 단축 | 물리적 한계 초과 시 Scale-Out 필요 |
| **A-2** | 좌석 소진 → 409 대량 발생 | 409 비율 급증 (5xx와 분리 모니터링) | 알림 기준 분리, 잔여 좌석 안내 | k6 threshold 수정, API 응답 개선 | 좌석 소진은 정상 시나리오 |
| **A-3** | 대기열 Polling 지연 | WAITING 토큰 수 급증, CS 문의 | 스케줄러 주기 단축, 활성 토큰 증가 | 이벤트 기반 즉시 활성화 | Polling 병행 운영 필요 |
| **B-1** | Kafka 장애 → 결제 API 500 | Kafka Producer 에러율, 결제 500 급증 | Kafka 복구, 미발송 이벤트 수동 재발행 | Transactional Outbox 패턴 | 단기는 비동기 발행으로 완화 |
| **B-2** | 예약 만료 이벤트 유실 → 좌석 점유 | HELD 만료 예약 잔존, Consumer Lag | 수동 SQL UPDATE, 스케줄러 fallback | DLQ 적용, setTimeout 블로킹 제거 | Polling 스케줄러가 10초 내 보상 |
| **B-3** | DB 커넥션 풀 기본값 → 고갈 | `Connection_errors_max_connections` | 유휴 커넥션 kill, 앱 재시작 | `connectionLimit: 30` 명시적 설정 | Max_connections MySQL 제한 내 운영 |
| **B-4** | Kafka 미연결 → Silent Failure | WARN 로그 지속, 알림 미발송 | Kafka 재연결, 이벤트 수동 재발행 | 인메모리 큐 + Outbox 패턴 | 앱 재시작 시 인메모리 큐 손실 |

---

## 5. 모니터링 핵심 지표 체크리스트

장애 조기 탐지를 위한 필수 모니터링 항목:

```yaml
# 즉시 알림 (P0)
- 5xx 에러율 > 1% (1분 지속)
- DB Threads_connected > 25 (커넥션 풀 80%)
- Redis 응답 없음 (30초)
- Kafka Producer 전송 실패 > 0 (5분 내)

# 주의 알림 (P1)
- http_req_duration p95 > 500ms (5분 지속)
- WAITING 토큰 수 > 200 (10분 지속)
- Kafka Consumer Lag > 100
- HELD 만료 예약 잔존 수 > 10

# 비즈니스 알림 (P2)
- 409 Conflict 비율 > 30% (좌석 소진 신호)
- 결제 성공률 < 95%
- 캐시 Hit Rate < 80%
```

---

**작성일**: 2026-03-01
**브랜치**: step10
