# Kafka를 활용한 비즈니스 프로세스 개선 설계

## 목차
1. [현재 시스템 분석](#1-현재-시스템-분석)
2. [대용량 트래픽 지점 파악](#2-대용량-트래픽-지점-파악)
3. [개선 방안 설계](#3-개선-방안-설계)
4. [구현 계획](#4-구현-계획)

---

## 1. 현재 시스템 분석

### 1-1. 콘서트 예약 프로세스

```
[사용자 요청 흐름]

1. 대기열 진입
   └─ QueueService: Redis 기반 대기열 관리

2. 좌석 조회
   └─ ConcertService: 스케줄별 좌석 조회

3. 좌석 예약 (HELD)
   └─ ReservationService: 분산락 + DB 트랜잭션
   └─ 5분 임시 배정

4. 결제
   └─ PaymentService: 포인트 차감 + 예약 확정 (CONFIRMED)
   └─ Kafka 이벤트 발행: payment.completed

5. 부가 작업
   ├─ RankingService: Redis 랭킹 갱신 (동기)
   └─ DataPlatformService: 예약 정보 전송 (Kafka Consumer)
```

### 1-2. 현재 시스템의 처리 방식

| 기능 | 처리 방식 | 문제점 |
|------|----------|--------|
| **예약 만료** | 스케줄러 폴링 (10초마다) | - DB 부하 증가<br>- 만료 시간 부정확 (최대 10초 오차)<br>- 만료된 예약 일괄 처리 시 병목 |
| **랭킹 갱신** | 동기 처리 (결제 시 즉시) | - 결제 응답 지연<br>- Redis 장애 시 결제 실패 위험 |
| **알림 발송** | ❌ 미구현 | - 사용자 경험 저하 |
| **데이터 플랫폼 전송** | Kafka Consumer (비동기) | ✅ 정상 (이미 개선됨) |

---

## 2. 대용량 트래픽 지점 파악

### 2-1. 트래픽 집중 시나리오

```
[인기 콘서트 예매 오픈 시점]

09:00:00  예매 오픈
          ↓
          대기열에 10만 명 진입 (순간 트래픽 폭증)
          ↓
09:00:01  선착순 1,000명 좌석 조회 시작
          ↓
09:00:05  좌석 예약 시작 (50석 경쟁)
          ↓
          [병목 구간 1] 좌석 예약 분산락 경쟁
          - 1개 좌석에 수백 건의 동시 요청
          - 분산락 대기 시간 증가
          ↓
09:01:00  예약 완료 (HELD 상태)
          ↓
09:01:00 ~ 09:06:00  결제 진행
          ↓
          [병목 구간 2] 결제 처리
          - DB 트랜잭션 집중
          - 랭킹 갱신 동기 처리
          ↓
09:06:00  미결제 예약 만료 시작
          ↓
          [병목 구간 3] 예약 만료 처리
          - 스케줄러가 1,000건의 만료 예약 일괄 처리
          - DB UPDATE 쿼리 집중
```

### 2-2. 병목 구간 상세 분석

#### **병목 구간 1: 좌석 예약 (분산락 경쟁)**

**현재 처리:**
```
동시 요청 500건 → 분산락 (seat:1) → 1명만 성공 → 499명 대기/실패
```

**처리량:**
- 분산락 획득: 평균 50ms
- 500건 처리 시간: 500 × 50ms = 25초
- **문제**: 사용자는 최대 25초 대기

**개선 여지:**
- ✅ 이미 분산락으로 최적화됨
- ✅ 추가 개선 어려움 (비즈니스 제약)

#### **병목 구간 2: 결제 처리 (랭킹 갱신)**

**현재 처리:**
```typescript
// PaymentService.processPayment()
await transaction(() => {
  // 1. 결제 저장
  // 2. 포인트 차감
  // 3. 예약 상태 변경
});

// 트랜잭션 밖에서 동기 처리
await this.rankingService.onReservationConfirmed(scheduleId);  // ⬅️ 병목
await this.kafkaProducer.sendPaymentCompletedEvent(...);
```

**처리 시간:**
- DB 트랜잭션: 100ms
- 랭킹 갱신: 50ms (Redis ZINCRBY)
- Kafka 발행: 10ms
- **총 응답 시간: 160ms**

**문제점:**
- 랭킹 갱신이 실패하면 결제는 성공했지만 랭킹에 반영 안 됨
- Redis 장애 시 결제 응답 지연

**개선 여지:**
- ✅ 랭킹 갱신을 Kafka Consumer로 비동기 처리
- ✅ 응답 시간: 160ms → 110ms (31% 개선)

#### **병목 구간 3: 예약 만료 처리 (폴링 방식)**

**현재 처리:**
```typescript
@Interval(10_000)  // 10초마다
async expireHeldReservations() {
  const expired = await findExpiredHeldReservations(new Date());
  // expired.length = 1,000건이라 가정

  for (const reservation of expired) {
    await updateStatus(reservation.id, 'EXPIRED');  // 순차 처리
  }
}
```

**문제점:**
1. **만료 시간 부정확**
   - 예약 생성: 09:01:00 → 만료: 09:06:00
   - 스케줄러 실행: 09:06:03 (최대 10초 오차)
   - **사용자는 이미 만료된 예약에 결제 시도 가능**

2. **DB 부하 집중**
   - 10초마다 전체 예약 테이블 스캔
   - 대량 UPDATE 쿼리 집중

3. **처리 지연**
   - 1,000건 × 10ms = 10초
   - 다음 스케줄러 실행 시점에 누적

**개선 여지:**
- ✅ Kafka 지연 메시지로 정확한 만료 시간 보장
- ✅ 폴링 제거 → DB 부하 80% 감소
- ✅ 이벤트 기반 처리 → 확장성 향상

---

## 3. 개선 방안 설계

### 3-1. 개선 대상 선정

| 개선 항목 | 우선순위 | 예상 효과 | 구현 난이도 |
|---------|---------|----------|-----------|
| **예약 만료 처리** | 🔴 높음 | DB 부하 80% 감소<br>만료 시간 정확성 100% | 중 |
| **랭킹 갱신 비동기화** | 🟡 중간 | 결제 응답 31% 개선<br>장애 격리 | 하 |
| **알림 시스템 구축** | 🟢 낮음 | 사용자 경험 향상 | 중 |

**최종 선정:**
1. ✅ **예약 만료 처리 개선** (필수)
2. ✅ **알림 시스템 구축** (선택)

---

## 4. 예약 만료 처리 개선 설계

### 4-1. 개선 전후 비교

#### **Before (스케줄러 폴링)**

```
[09:01:00] 예약 생성 (HELD)
           expiresAt = 09:06:00

[09:06:03] 스케줄러 실행 (10초 지연)
           ├─ SELECT * FROM reservation WHERE status = 'HELD' AND expiresAt < NOW()
           │  → 1,000건 조회
           └─ For each: UPDATE status = 'EXPIRED'
              → DB 부하 집중

문제점:
- 만료 시간 부정확 (최대 10초 오차)
- DB 부하 집중 (10초마다 전체 테이블 스캔)
- 확장성 제한 (단일 스케줄러)
```

#### **After (Kafka 지연 메시지)**

```
[09:01:00] 예약 생성 (HELD)
           expiresAt = 09:06:00
           ↓
           Kafka Producer 발행
           Topic: reservation.expiration
           Message: { reservationId, expiresAt }
           Timestamp: 09:06:00 (5분 후)

[09:06:00] Kafka Consumer 처리 (정확한 시간)
           └─ UPDATE status = 'EXPIRED' WHERE reservationId = ? AND status = 'HELD'
              → 조건부 UPDATE (1건만)

장점:
✅ 만료 시간 정확성 100%
✅ DB 부하 80% 감소 (테이블 스캔 제거)
✅ 수평 확장 가능 (Consumer 추가)
✅ 재시도 메커니즘 내장
```

### 4-2. Kafka 구성

#### **Topic 설계**

```yaml
Topic: reservation.expiration

Config:
  partitions: 3
  replication-factor: 3
  retention.ms: 86400000  # 24시간 (재처리 대비)
  message.timestamp.type: LogAppendTime

Message Schema:
  {
    "eventId": "evt_1234567890",
    "eventType": "reservation.expiration",
    "eventTime": "2026-02-28T14:06:00Z",  # 만료 시간 (5분 후)
    "payload": {
      "reservationId": "res_xxx",
      "userId": "user_xxx",
      "seatId": "seat_xxx",
      "expiresAt": "2026-02-28T14:06:00Z"
    }
  }

Partitioning Key: reservationId (같은 예약은 순서 보장)
```

#### **Producer 구성**

```typescript
// ReservationService.holdSeat()
async holdSeat(userId: string, scheduleId: string, seatNo: number) {
  const reservation = await transaction(() => {
    // 1. 예약 생성 (HELD)
    // 2. expiresAt 계산 (현재 시간 + 5분)
  });

  // 3. Kafka에 만료 이벤트 발행 (5분 후 처리)
  await this.kafkaProducer.sendReservationExpirationEvent({
    reservationId: reservation.reservationId,
    userId: reservation.userId,
    seatId: reservation.seatId,
    expiresAt: reservation.expiresAt,
  });

  return reservation;
}
```

#### **Consumer 구성**

```typescript
// ReservationExpirationConsumer
@Injectable()
export class ReservationExpirationConsumer extends KafkaConsumerService {
  constructor(private readonly reservationService: ReservationService) {
    super('reservation-expiration-group', ReservationExpirationConsumer.name);
  }

  async onModuleInit() {
    await this.connect(['reservation.expiration']);
  }

  protected async handleMessage(payload: EachMessagePayload) {
    const event = JSON.parse(payload.message.value.toString());

    // 조건부 UPDATE: HELD 상태인 경우만 EXPIRED로 변경
    const updated = await this.reservationService.expireReservation(
      event.payload.reservationId,
    );

    if (updated) {
      // 만료 알림 발송 (선택)
      await this.sendExpirationNotification(event.payload);
    }
  }
}
```

### 4-3. 지연 메시지 처리 전략

Kafka는 기본적으로 지연 메시지를 지원하지 않으므로, 두 가지 방법을 고려:

#### **방법 1: Timestamp 기반 필터링 (채택)**

```typescript
// Consumer에서 메시지 수신 시 expiresAt 체크
protected async handleMessage(payload: EachMessagePayload) {
  const event = JSON.parse(payload.message.value.toString());
  const now = new Date();
  const expiresAt = new Date(event.payload.expiresAt);

  // 아직 만료 시간이 안 됐으면 재발행
  if (now < expiresAt) {
    const delay = expiresAt.getTime() - now.getTime();
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // 만료 처리
  await this.reservationService.expireReservation(event.payload.reservationId);
}
```

**장점:**
- 구현 간단
- Kafka 기본 기능만 사용

**단점:**
- Consumer가 대기 중 메시지 처리 블로킹
- 확장성 제한

#### **방법 2: 별도 지연 큐 사용 (권장)**

```
[Producer] 예약 생성
     ↓
  Kafka Topic: reservation.created
     ↓
  [Delay Scheduler Consumer]
     ├─ Redis ZADD (expiresAt를 score로 저장)
     └─ key: reservation:expiration:{timestamp}
         value: {reservationId, userId, ...}

  [Scheduler] 1초마다
     ├─ Redis ZRANGEBYSCORE (현재 시간 이하)
     ├─ 만료된 예약 조회
     └─ Kafka Topic: reservation.expiration 발행

  [Expiration Consumer]
     └─ 예약 만료 처리
```

**장점:**
- Consumer 블로킹 없음
- 대량 처리 가능
- 확장성 우수

**단점:**
- Redis 의존성 추가
- 구현 복잡도 증가

**최종 선택:** 방법 1 (간단한 구현)
- 현재 예약 규모(50석)에서는 충분
- 추후 확장 필요 시 방법 2로 전환

---

## 5. 알림 시스템 구축 설계

### 5-1. 알림 시나리오

| 이벤트 | 알림 대상 | 알림 내용 | 우선순위 |
|--------|---------|----------|---------|
| 예약 확정 | 예약자 | "결제가 완료되었습니다. 콘서트 예약이 확정되었습니다." | 높음 |
| 예약 만료 | 예약자 | "5분 이내 결제하지 않아 예약이 만료되었습니다." | 중간 |
| 대기열 진입 | 대기자 | "현재 대기 순번은 123번입니다." | 낮음 |
| 좌석 오픈 | 대기자 | "예약 가능한 시간입니다." | 높음 |

### 5-2. Kafka 구성

```yaml
Topic: notification.request

Config:
  partitions: 3
  replication-factor: 3
  retention.ms: 604800000  # 7일 (재전송 대비)

Message Schema:
  {
    "eventId": "evt_1234567890",
    "eventType": "notification.request",
    "eventTime": "2026-02-28T14:00:00Z",
    "payload": {
      "userId": "user_xxx",
      "type": "PAYMENT_CONFIRMED",  # PAYMENT_CONFIRMED, RESERVATION_EXPIRED, ...
      "title": "결제 완료",
      "message": "콘서트 예약이 확정되었습니다.",
      "data": {
        "reservationId": "res_xxx",
        "concertTitle": "아이유 콘서트",
        "concertDate": "2026-03-15"
      }
    }
  }
```

### 5-3. Producer 통합

```typescript
// 1. PaymentService (결제 확정 알림)
await this.kafkaProducer.sendNotificationRequest({
  userId,
  type: 'PAYMENT_CONFIRMED',
  title: '결제 완료',
  message: `${concertTitle} 예약이 확정되었습니다.`,
  data: { reservationId, concertTitle, concertDate },
});

// 2. ReservationExpirationConsumer (만료 알림)
await this.kafkaProducer.sendNotificationRequest({
  userId: event.payload.userId,
  type: 'RESERVATION_EXPIRED',
  title: '예약 만료',
  message: '5분 이내 결제하지 않아 예약이 만료되었습니다.',
  data: { reservationId: event.payload.reservationId },
});
```

### 5-4. Consumer 구현

```typescript
// NotificationConsumer
@Injectable()
export class NotificationConsumer extends KafkaConsumerService {
  constructor(private readonly notificationService: NotificationService) {
    super('notification-service-group', NotificationConsumer.name);
  }

  async onModuleInit() {
    await this.connect(['notification.request']);
  }

  protected async handleMessage(payload: EachMessagePayload) {
    const event = JSON.parse(payload.message.value.toString());

    // 알림 전송 (Mock: 로그만 출력)
    await this.notificationService.send({
      userId: event.payload.userId,
      type: event.payload.type,
      title: event.payload.title,
      message: event.payload.message,
      data: event.payload.data,
    });
  }
}
```

---

## 6. 시퀀스 다이어그램

### 6-1. 예약 만료 처리 (Kafka 개선)

```
사용자          ReservationService      KafkaProducer       KafkaBroker      ExpirationConsumer      DB
  │                    │                      │                  │                   │              │
  │ POST /reserve      │                      │                  │                   │              │
  ├───────────────────>│                      │                  │                   │              │
  │                    │                      │                  │                   │              │
  │                    │ BEGIN TX             │                  │                   │              │
  │                    ├─────────────────────────────────────────────────────────────>│
  │                    │                      │                  │                   │              │
  │                    │ INSERT reservation   │                  │                   │              │
  │                    ├─────────────────────────────────────────────────────────────>│
  │                    │ (status=HELD, expiresAt=now+5min)       │                   │              │
  │                    │<────────────────────────────────────────────────────────────┤
  │                    │                      │                  │                   │              │
  │                    │ COMMIT               │                  │                   │              │
  │                    ├─────────────────────────────────────────────────────────────>│
  │                    │                      │                  │                   │              │
  │                    │ sendExpirationEvent  │                  │                   │              │
  │                    ├─────────────────────>│                  │                   │              │
  │                    │                      │ Produce message  │                   │              │
  │                    │                      ├─────────────────>│                   │              │
  │                    │                      │                  │ (저장: expiresAt) │              │
  │<───────────────────┤                      │                  │                   │              │
  │ 200 OK             │                      │                  │                   │              │
  │                    │                      │                  │                   │              │
  │                    │                      │                  │                   │              │
  │ ... 5분 경과 ...    │                      │                  │                   │              │
  │                    │                      │                  │                   │              │
  │                    │                      │                  │ Consume message   │              │
  │                    │                      │                  ├──────────────────>│              │
  │                    │                      │                  │                   │              │
  │                    │                      │                  │                   │ UPDATE       │
  │                    │                      │                  │                   ├─────────────>│
  │                    │                      │                  │                   │ SET status   │
  │                    │                      │                  │                   │ = 'EXPIRED'  │
  │                    │                      │                  │                   │ WHERE id=?   │
  │                    │                      │                  │                   │ AND status   │
  │                    │                      │                  │                   │ = 'HELD'     │
  │                    │                      │                  │                   │<────────────┤
  │                    │                      │                  │                   │              │
  │                    │                      │                  │ sendNotification  │              │
  │                    │                      │                  │<──────────────────┤              │
  │                    │                      │                  │ (알림 발송)        │              │
```

### 6-2. 알림 발송 (Kafka 비동기)

```
PaymentService      KafkaProducer      KafkaBroker      NotificationConsumer      NotificationService
     │                    │                 │                    │                         │
     │ processPayment     │                 │                    │                         │
     │ (결제 완료)         │                 │                    │                         │
     │                    │                 │                    │                         │
     │ sendNotification   │                 │                    │                         │
     ├───────────────────>│                 │                    │                         │
     │                    │ Produce         │                    │                         │
     │                    ├────────────────>│                    │                         │
     │                    │                 │ (저장)             │                         │
     │<───────────────────┤                 │                    │                         │
     │ (즉시 반환)         │                 │                    │                         │
     │                    │                 │                    │                         │
     │                    │                 │ Consume            │                         │
     │                    │                 ├───────────────────>│                         │
     │                    │                 │                    │                         │
     │                    │                 │                    │ send()                  │
     │                    │                 │                    ├────────────────────────>│
     │                    │                 │                    │                         │
     │                    │                 │                    │                         │ Mock:
     │                    │                 │                    │                         │ Log
     │                    │                 │                    │<────────────────────────┤
     │                    │                 │                    │                         │
```

---

## 7. 성능 개선 예상치

### 7-1. 예약 만료 처리

| 지표 | Before (스케줄러) | After (Kafka) | 개선율 |
|------|------------------|---------------|--------|
| **만료 시간 정확성** | ±10초 | ±100ms | 99% |
| **DB 부하** | 10초마다 전체 스캔 | 조건부 UPDATE만 | 80% ↓ |
| **처리 지연** | 최대 10초 | 실시간 | 100% |
| **확장성** | 단일 스케줄러 | Consumer 수평 확장 | ∞ |

### 7-2. 알림 발송

| 지표 | Before (미구현) | After (Kafka) | 효과 |
|------|----------------|---------------|------|
| **응답 시간** | N/A | +10ms (Kafka 발행) | 사용자 경험 향상 |
| **처리량** | N/A | 초당 10,000건+ | 대량 발송 가능 |
| **신뢰성** | N/A | 재시도 + 멱등성 | 유실 방지 |

### 7-3. 전체 시스템 개선

```
[Before] 인기 콘서트 예매 (1,000명 동시 접속)

09:01:00  예약 시작
09:06:00  만료 처리 시작
          ├─ DB 부하: 1,000 SELECT + 1,000 UPDATE
          └─ 처리 시간: 10초
09:06:10  만료 처리 완료

문제점:
- 만료 시간 부정확 (최대 10초 오차)
- DB CPU: 80% 스파이크
- 사용자 혼란 (이미 만료된 예약에 결제 시도)


[After] Kafka 기반 개선

09:01:00  예약 시작
          └─ Kafka 이벤트 발행 (비동기)
09:06:00  만료 처리 (정확한 시간)
          ├─ Consumer가 분산 처리
          └─ 각 예약별 조건부 UPDATE (1건씩)

개선:
✅ 만료 시간 정확성 100%
✅ DB 부하 80% 감소
✅ 사용자 경험 향상 (즉시 알림)
```

---

## 8. 위험 요소 및 대응 방안

### 8-1. Kafka 장애 시나리오

**시나리오 1: Kafka 브로커 다운**

```
문제:
- 예약 생성은 성공 (DB 저장)
- Kafka 발행 실패 → 만료 이벤트 누락

대응:
1. Outbox 패턴 적용
   └─ 예약 생성 시 outbox_events 테이블에 함께 저장
   └─ Outbox Poller가 Kafka로 재발행

2. Fallback: 스케줄러 병행 운영 (안전장치)
   └─ Kafka 우선, 실패 시 스케줄러가 백업
```

**시나리오 2: Consumer 장애**

```
문제:
- Consumer가 다운되어 만료 처리 안 됨

대응:
1. Consumer Group 활용
   └─ 여러 Consumer 인스턴스 운영
   └─ 하나가 죽어도 다른 Consumer가 처리

2. 모니터링 + 알림
   └─ Consumer Lag > threshold → Slack 알림
```

### 8-2. 메시지 중복 처리

```
문제:
- Kafka는 at-least-once 전달 보장
- 같은 예약이 중복 만료 처리될 수 있음

대응:
- 조건부 UPDATE 사용
  UPDATE reservation
  SET status = 'EXPIRED'
  WHERE reservationId = ? AND status = 'HELD'

  → status가 이미 EXPIRED면 영향 없음 (멱등성)
```

---

## 9. 마이그레이션 전략

### 9-1. 단계별 전환

```
Phase 1: Kafka 인프라 구축 (1주)
  ├─ Topic 생성: reservation.expiration, notification.request
  └─ Producer/Consumer 구현

Phase 2: 병행 운영 (2주)
  ├─ Kafka + 스케줄러 동시 실행
  ├─ Kafka 우선, 스케줄러는 백업
  └─ 모니터링 및 안정화

Phase 3: 완전 전환 (1주)
  ├─ 스케줄러 비활성화
  └─ Kafka만 운영
```

### 9-2. 롤백 계획

```
만약 Kafka 문제 발생 시:
1. 스케줄러 재활성화 (1분 내)
2. Kafka Consumer 비활성화
3. 원인 분석 및 수정
4. 재배포 후 다시 전환
```

---

## 10. 정리

### 10-1. 핵심 개선 사항

| 항목 | 개선 방법 | 예상 효과 |
|------|----------|----------|
| **예약 만료 처리** | Kafka 지연 메시지 | - 만료 시간 정확성 99% 향상<br>- DB 부하 80% 감소<br>- 수평 확장 가능 |
| **알림 시스템** | Kafka 비동기 발송 | - 사용자 경험 향상<br>- 대량 발송 가능<br>- 확장성 확보 |

### 10-2. Kafka 사용 이유

1. **정확한 타이밍 보장**
   - 스케줄러 폴링(±10초) → 이벤트 기반(±100ms)

2. **DB 부하 감소**
   - 주기적 전체 스캔 → 이벤트 발생 시점만 처리

3. **수평 확장**
   - Consumer 추가로 처리량 증가

4. **장애 격리**
   - 알림 실패가 결제에 영향 없음

5. **재처리 가능**
   - 메시지 영속성으로 장애 복구 가능

---

**작성일**: 2026-02-28
**작성자**: 콘서트 예약 서비스 개발팀
**버전**: 1.0
