# 동시성 제어 보고서

## 1. 문제 상황 식별

콘서트 예약 서비스에서 다수의 사용자가 동시에 요청할 때 발생할 수 있는 3가지 핵심 동시성 이슈를 식별했습니다.

### 1-1. 좌석 중복 예약 (Double Booking)

**시나리오:** 10명의 사용자가 동시에 같은 좌석을 예약 요청

```
User A ──→ SELECT * FROM reservation WHERE seatId = ? ──→ 없음 ──→ INSERT (HELD)
User B ──→ SELECT * FROM reservation WHERE seatId = ? ──→ 없음 ──→ INSERT (HELD)  ← 중복!
```

**위험:** 조회 시점에는 둘 다 "빈 좌석"으로 보여, 2명 이상이 동시에 예약에 성공하는 **Lost Update** 발생

### 1-2. 잔액 차감 충돌 (Negative Balance)

**시나리오:** 잔액 5,000원인 사용자가 동시에 여러 건의 2,000원 결제를 시도

```
Thread 1 ──→ SELECT balance (5000) ──→ 5000 >= 2000 ✓ ──→ UPDATE balance = 3000
Thread 2 ──→ SELECT balance (5000) ──→ 5000 >= 2000 ✓ ──→ UPDATE balance = 3000  ← 3000이어야 1000
Thread 3 ──→ SELECT balance (5000) ──→ 5000 >= 2000 ✓ ──→ UPDATE balance = 3000  ← 음수 발생!
```

**위험:** 읽기-확인-쓰기 사이의 간격에서 다른 트랜잭션이 잔액을 변경 → **음수 잔액** 발생

### 1-3. 결제-만료 스케줄러 경합 (Payment vs Scheduler Race)

**시나리오:** 사용자가 결제하는 동시에 만료 스케줄러가 같은 예약을 만료 처리

```
결제 Thread  ──→ reservation.status = HELD ──→ 결제 처리 중... ──→ status = CONFIRMED
스케줄러     ──→ reservation.status = HELD ──→ status = EXPIRED  ← 결제 완료된 건을 덮어씀!
```

**위험:** 결제가 성공했지만 스케줄러가 뒤늦게 EXPIRED로 변경 → **결제 완료 예약 소실**

---

## 2. 해결 전략

### 2-1. 좌석 임시 배정 — Pessimistic Write Lock (SELECT FOR UPDATE)

**적용 파일:** `src/reservation/reservation.service.ts`

```typescript
return this.dataSource.transaction(async (manager) => {
  const existing = await manager.findOne(Reservation, {
    where: {
      seatId: seat.seatId,
      status: In([ReservationStatus.HELD, ReservationStatus.CONFIRMED]),
    },
    lock: { mode: 'pessimistic_write' },  // SELECT ... FOR UPDATE
  });

  if (existing) {
    throw new BadRequestException('이미 임시 배정된 좌석입니다.');
  }

  // 예약 생성 (HELD 상태, 5분 후 만료)
  return manager.save(reservation);
});
```

**동작 원리:**
1. `SELECT ... FOR UPDATE`로 해당 좌석의 예약 행에 **배타적 락**을 건다
2. 다른 트랜잭션은 락이 해제될 때까지 대기
3. 첫 번째 트랜잭션이 INSERT 후 커밋하면, 대기 중이던 트랜잭션이 조회 → 이미 HELD 상태 → 예외 발생

**선택 이유:** 좌석 예약은 "선착순 1명만 성공"이라는 강한 일관성이 필요하므로, 낙관적 락보다 비관적 락이 적합. 충돌 빈도가 높은 인기 좌석에서 재시도 비용을 피할 수 있음.

### 2-2. 잔액 차감 — Pessimistic Write Lock + 원자적 UPSERT

**적용 파일:** `src/point/point.service.ts`

#### 충전 (Lost Update 방지)

```typescript
await manager.query(
  `INSERT INTO user_point_balance (userId, balance) VALUES (?, ?)
   ON DUPLICATE KEY UPDATE balance = balance + ?`,
  [userId, amount, amount],
);
```

- SQL 레벨의 **원자적 증가 연산**(`balance = balance + ?`)으로 애플리케이션 단의 읽기-쓰기 분리를 제거
- 10개 스레드가 동시에 1,000원씩 충전해도 최종 잔액은 정확히 10,000원

#### 사용 (음수 잔액 방지)

```typescript
const balance = await manager.findOne(UserPointBalance, {
  where: { userId },
  lock: { mode: 'pessimistic_write' },  // SELECT ... FOR UPDATE
});

if (Number(balance.balance) < amount) {
  throw new BadRequestException('포인트 잔액이 부족합니다.');
}

balance.balance = Number(balance.balance) - amount;
await manager.save(balance);
```

- **비관적 락**으로 잔액 행을 잠근 후 차감, 다른 트랜잭션은 대기
- 잔액 확인과 차감이 하나의 트랜잭션 + 락 안에서 원자적으로 처리

### 2-3. 결제 중복 방지 — Pessimistic Write Lock on Reservation

**적용 파일:** `src/payment/payment.service.ts`

```typescript
return this.dataSource.transaction(async (manager) => {
  const reservation = await manager.findOne(Reservation, {
    where: { reservationId },
    lock: { mode: 'pessimistic_write' },
  });

  if (reservation.status !== ReservationStatus.HELD) {
    throw new BadRequestException('HELD 상태의 예약만 결제할 수 있습니다.');
  }

  // 결제 생성 → 포인트 차감 → 예약 CONFIRMED
});
```

- 예약 행에 비관적 락을 걸어 **동시 결제 요청 직렬화**
- 첫 번째 결제가 CONFIRMED로 바꾸면, 이후 요청은 상태 체크에서 실패

### 2-4. 스케줄러-결제 경합 — 조건부 UPDATE

**적용 파일:** `src/reservation/reservation.scheduler.ts`

```typescript
@Interval(10_000)
async expireHeldReservations(): Promise<void> {
  const expired = await this.reservationRepository.findExpiredHeldReservations(new Date());

  for (const reservation of expired) {
    // 조건부 UPDATE: status가 여전히 HELD일 때만 EXPIRED로 변경
    const result = await this.dataSource.query(
      `UPDATE reservation SET status = ? WHERE reservationId = ? AND status = ?`,
      [ReservationStatus.EXPIRED, reservation.reservationId, ReservationStatus.HELD],
    );

    if (result.affectedRows > 0) {
      this.logger.log(`예약 ${reservation.reservationId} 만료 처리 완료`);
    }
  }
}
```

**동작 원리:**
- `WHERE ... AND status = 'HELD'` 조건으로 **이미 CONFIRMED된 예약은 건드리지 않음**
- 결제가 먼저 CONFIRMED로 바꿨다면, 스케줄러의 UPDATE는 `affectedRows = 0`으로 자연스럽게 skip
- 별도의 락 없이 **CAS(Compare-And-Swap)** 패턴으로 경합 해결

---

## 3. 사용한 동시성 제어 기법 요약

| 기법 | 적용 위치 | SQL 패턴 |
|------|----------|----------|
| **SELECT FOR UPDATE** (비관적 락) | 좌석 예약, 포인트 사용, 결제 처리 | `lock: { mode: 'pessimistic_write' }` |
| **조건부 UPDATE** | 만료 스케줄러 | `UPDATE ... WHERE status = 'HELD'` |
| **원자적 UPSERT** | 포인트 충전 | `ON DUPLICATE KEY UPDATE balance = balance + ?` |

---

## 4. 멀티스레드 테스트 및 결과

테스트 파일: `test/it/concurrency.it.spec.ts`

모든 테스트는 `Promise.allSettled`로 여러 비동기 요청을 동시에 발행하여 실제 동시성 환경을 시뮬레이션합니다. Testcontainers로 격리된 MySQL 인스턴스에서 실행됩니다.

### 4-1. 좌석 예약 동시성

| 항목 | 값 |
|------|-----|
| **시나리오** | 10명이 동시에 같은 좌석(40번)을 예약 |
| **기대 결과** | 1명 성공, 9명 실패 |
| **검증** | DB에 HELD 상태 예약이 정확히 1건 |
| **결과** | ✅ PASS |

### 4-2. 포인트 충전 동시성

| 항목 | 값 |
|------|-----|
| **시나리오** | 같은 유저가 동시에 10번 × 1,000원 충전 |
| **기대 결과** | 10건 모두 성공, 최종 잔액 10,000원 |
| **검증** | Lost Update 없이 정확한 합산 |
| **결과** | ✅ PASS |

### 4-3. 포인트 사용 동시성

| 항목 | 값 |
|------|-----|
| **시나리오** | 잔액 5,000원, 동시에 5건의 2,000원 결제 시도 |
| **기대 결과** | 2건 성공, 3건 실패, 잔액 1,000원 |
| **검증** | 음수 잔액 미발생 |
| **결과** | ✅ PASS |

### 4-4. 결제 중복 처리 동시성

| 항목 | 값 |
|------|-----|
| **시나리오** | 같은 예약에 대해 동시에 5번 결제 시도 |
| **기대 결과** | 1건 성공, 4건 실패, 포인트 1회만 차감 |
| **검증** | 잔액 = 초기 100,000 - 10,000 = 90,000원 |
| **결과** | ✅ PASS |

### 4-5. 만료 스케줄러 테스트 (3건)

| 시나리오 | 기대 결과 | 결과 |
|---------|----------|------|
| 만료된 예약 → 스케줄러 실행 → 같은 좌석 재예약 | EXPIRED 전환 후 User B 재예약 성공 | ✅ PASS |
| 만료된 예약에 결제 시도 | `예약이 만료되었습니다` 예외, 포인트 미차감 | ✅ PASS |
| 결제와 스케줄러 동시 실행 | 결제 성공 + 예약 CONFIRMED 유지 (스케줄러 skip) | ✅ PASS |

---

## 5. 결론

### 적용한 동시성 제어 조합

```
좌석 예약      → SELECT FOR UPDATE (비관적 락)
포인트 충전    → 원자적 UPSERT (SQL 레벨)
포인트 사용    → SELECT FOR UPDATE (비관적 락)
결제 처리      → SELECT FOR UPDATE (비관적 락)
만료 스케줄러  → 조건부 UPDATE (CAS 패턴)
```

### 비관적 락을 주로 선택한 이유

1. **높은 충돌 빈도**: 인기 좌석은 동시 요청이 집중되어 낙관적 락의 재시도 비용이 큼
2. **강한 일관성 요구**: 좌석 예약과 잔액 차감은 "정확히 1번"만 성공해야 하므로 직렬화가 필수
3. **단순한 구현**: TypeORM의 `lock: { mode: 'pessimistic_write' }`로 간결하게 적용 가능

### 조건부 UPDATE를 스케줄러에 적용한 이유

- 스케줄러는 결제와 **다른 트랜잭션 범위**에서 실행되므로, 비관적 락 대신 `WHERE status = 'HELD'` 조건으로 충돌을 자연스럽게 회피
- 락 대기 없이 즉시 실행되어 스케줄러의 처리량(throughput)을 유지

---

## 6. Distributed Lock (분산락)

### 6-1. 왜 분산락이 필요한가?

기존 비관적 락(SELECT FOR UPDATE)은 **단일 DB 인스턴스** 내에서만 동작합니다. 다수의 애플리케이션 인스턴스가 동작하는 분산 환경에서는 다음과 같은 한계가 있습니다:

| 문제 | 설명 |
|------|------|
| **DB 커넥션 점유** | 비관적 락 대기 중 DB 커넥션을 계속 잡고 있어 커넥션 풀 고갈 위험 |
| **단일 DB 의존** | DB 장애 시 락 메커니즘 전체가 무력화 |
| **확장성 한계** | DB 레벨 락은 인스턴스 수가 늘어날수록 경합이 심화 |

Redis 기반 분산락은 DB와 독립적으로 동작하여 이 문제들을 해결합니다.

### 6-2. 구현 방식 — Redis SET NX PX

**적용 파일:** `src/infrastructure/distributed-lock/distributed-lock.service.ts`

```typescript
// 락 획득: SET key value NX PX ttl
const result = await this.redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');

// 락 해제: Lua 스크립트로 소유자 검증 후 atomic 삭제
const UNLOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;
```

**핵심 설계:**

| 요소 | 설명 |
|------|------|
| **SET NX** | 키가 존재하지 않을 때만 설정 → 하나의 프로세스만 락 획득 |
| **PX (TTL)** | 락 만료 시간 설정 → 프로세스 장애 시에도 데드락 방지 |
| **UUID 값** | 각 락에 고유 값 부여 → 소유자만 해제 가능 (다른 프로세스의 잘못된 해제 방지) |
| **Lua 스크립트** | GET + DEL을 atomic하게 실행 → 소유자 검증과 삭제 사이 Race Condition 방지 |
| **Spin-wait 재시도** | 락 획득 실패 시 일정 간격(50ms)으로 재시도, 최대 대기 시간(3s) 초과 시 예외 |

### 6-3. 분산락과 DB 트랜잭션 혼용 시 주의점

**가장 중요한 원칙: 분산락은 DB 트랜잭션 바깥에서 감싸야 합니다.**

```
✅ 올바른 순서:
  분산락 획득 → DB Tx 시작 → 작업 수행 → DB Tx 커밋 → 분산락 해제

❌ 잘못된 순서:
  DB Tx 시작 → 분산락 획득 대기 → (DB 커넥션 점유 중...) → 작업 수행 → 커밋 → 해제
```

**잘못된 순서의 문제점:**

1. **커넥션 풀 고갈**: 락 대기 중에도 DB 커넥션을 점유하므로, 동시 요청이 몰리면 커넥션 풀이 소진됨
2. **데드락 위험**: Thread A가 커넥션 1을 잡고 락 대기, Thread B가 락을 잡고 커넥션 대기 → 서로 영원히 대기
3. **트랜잭션 타임아웃**: 락 대기 시간이 DB 트랜잭션 타임아웃을 초과하면 롤백 발생

**실제 적용 코드 (ReservationService):**

```typescript
async holdSeat(userId, scheduleId, seatNo): Promise<Reservation> {
  const seat = await this.concertRepository.findSeatByScheduleAndNo(scheduleId, seatNo);

  // 1. 분산락 획득 (DB 트랜잭션 바깥)
  return this.distributedLockService.withLock(`seat:${seat.seatId}`, async () => {
    // 2. 락 획득 후 DB 트랜잭션 시작
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(Reservation, { ... });
      if (existing) throw new BadRequestException('이미 임시 배정된 좌석입니다.');
      return manager.save(reservation);
    });
    // 3. DB Tx 커밋 → 분산락 해제
  });
}
```

분산락이 동시성을 보장하므로, 락 안에서는 `pessimistic_write`가 불필요 → 일반 `findOne`으로 변경하여 DB 부하 감소.

### 6-4. 적용 범위 — 적절한 키와 락 범위 선정

| 기능 | 락 키 | 범위 | 선정 이유 |
|------|--------|------|----------|
| **좌석 예약** | `lock:seat:{seatId}` | 좌석 단위 | 같은 좌석의 이중 예약만 방지. 다른 좌석 요청은 병렬 처리 |
| **결제 처리** | `lock:reservation:{reservationId}` | 예약 단위 | 같은 예약의 중복 결제만 방지. 다른 예약 결제는 병렬 처리 |
| **포인트 충전** | `lock:point:{userId}` | 유저 단위 | 같은 유저의 동시 충전으로 인한 Lost Update 방지 |
| **포인트 사용** | `lock:point:{userId}` | 유저 단위 | 충전과 동일 키로 충전/사용 연산 직렬화. 잔액 부족 미감지 방지 |

**키 설계 원칙:**
- 락 범위는 **최소한의 자원 단위**로 설정 (좌석 단위, 예약 단위, 유저 단위)
- 범위가 넓으면 (예: 스케줄 단위로 좌석 락) 불필요한 대기 발생 → 처리량 저하
- 범위가 좁으면 (예: 트랜잭션 단위) 동시성 제어가 무력화

### 6-5. 분산락 통합 테스트

테스트 파일: `test/it/distributed-lock.it.spec.ts`

#### 분산락 기본 동작 테스트 (4건)

| 시나리오 | 기대 결과 | 결과 |
|---------|----------|------|
| 같은 키로 동시에 락 획득 시 순차 실행 | 3개 태스크 모두 성공, 순차적으로 실행 | ✅ PASS |
| 락 획득 대기 시간 초과 | `DistributedLockAcquisitionError` 예외 발생 | ✅ PASS |
| 다른 키는 동시에 락 획득 가능 | 병렬 실행 (~200ms, 직렬이면 ~400ms) | ✅ PASS |
| 콜백 예외 발생 시 락 해제 | 예외 후 즉시 재획득 가능 | ✅ PASS |

#### 비즈니스 로직 동시성 테스트 (4건)

| 시나리오 | 기대 결과 | 결과 |
|---------|----------|------|
| 10명 동시 좌석 예약 | 1명 성공, 9명 실패, DB HELD 1건 | ✅ PASS |
| 동시 10회 × 1,000원 충전 | 10건 모두 성공, 잔액 10,000원 | ✅ PASS |
| 잔액 5,000원에서 5건 × 2,000원 사용 | 2건 성공, 3건 실패, 잔액 1,000원 | ✅ PASS |
| 같은 예약 동시 5회 결제 | 1건 성공, 4건 실패, 포인트 1회만 차감 | ✅ PASS |

### 6-6. 기존 비관적 락 vs 분산락 비교

| 항목 | Pessimistic Lock (SELECT FOR UPDATE) | Distributed Lock (Redis) |
|------|--------------------------------------|--------------------------|
| **락 위치** | DB 행 레벨 | Redis 키 레벨 |
| **다중 인스턴스** | 동일 DB를 사용하면 동작 | 독립적으로 동작 ✅ |
| **커넥션 점유** | 락 대기 중 DB 커넥션 점유 ❌ | DB 커넥션 불필요 ✅ |
| **장애 내성** | DB 장애 시 무력화 | Redis 장애 시 무력화 (Redlock으로 보완 가능) |
| **성능** | DB 부하 증가 | DB 부하 감소 ✅ |
| **구현 복잡도** | 낮음 (ORM 지원) | 중간 (직접 구현 필요) |

---

## 7. Cache (캐시)

### 7-1. 시나리오별 쿼리 분석 및 캐시 가능 구간

각 API에서 발생하는 쿼리를 분석하여 캐시 적용 가능 여부를 판단합니다.

#### 콘서트 일정 조회 (`getAvailableSchedules`)

```sql
SELECT * FROM concert_schedule WHERE concertId = ? ORDER BY concertDate ASC
```

| 항목 | 분석 |
|------|------|
| **호출 빈도** | 매우 높음 — 모든 사용자가 예약 전 조회 |
| **데이터 변경 빈도** | 매우 낮음 — 콘서트 일정은 관리자만 변경 |
| **캐시 적합성** | ✅ **매우 적합** |
| **캐시 전략** | **Cache-Aside (Look-Aside)** |
| **TTL** | 10~30분 (일정 변경 반영 허용 범위) |
| **캐시 키** | `cache:schedule:{concertId}` |

#### 좌석 목록 조회 (`getAvailableSeats`)

```sql
SELECT * FROM seat WHERE scheduleId = ? ORDER BY seatNo ASC
```

| 항목 | 분석 |
|------|------|
| **호출 빈도** | 높음 — 사용자가 날짜 선택 후 좌석 확인 |
| **데이터 변경 빈도** | 없음 — 좌석 마스터 데이터는 불변 |
| **캐시 적합성** | ✅ **매우 적합** |
| **캐시 전략** | **Cache-Aside**, TTL 길게 설정 가능 |
| **TTL** | 1~24시간 (좌석 마스터 데이터는 변경되지 않음) |
| **캐시 키** | `cache:seats:{scheduleId}` |

> **주의:** 좌석의 "예약 가능 여부"는 실시간성이 필요하므로 별도 처리가 필요합니다. 좌석 마스터(seatId, seatNo)만 캐시하고, 예약 상태는 DB에서 조회하는 것이 적합합니다.

#### 포인트 잔액 조회 (`getBalance`)

```sql
SELECT * FROM user_point_balance WHERE userId = ? LIMIT 1
```

| 항목 | 분석 |
|------|------|
| **호출 빈도** | 중간 — 사용자별 조회 |
| **데이터 변경 빈도** | 높음 — 충전/결제 시마다 변경 |
| **캐시 적합성** | ⚠️ **주의 필요** |
| **캐시 전략** | **Write-Through** (변경 시 캐시 즉시 갱신) 또는 캐시 미적용 |
| **TTL** | 짧게 (1~5초) 또는 변경 시 invalidation |
| **캐시 키** | `cache:point:{userId}` |

> 포인트 잔액은 정합성이 중요합니다. 캐시된 잔액으로 결제 가능 여부를 판단하면 안 되므로, 캐시는 **단순 조회 API용**으로만 사용하고 실제 차감 로직에서는 DB를 직접 참조해야 합니다.

#### 대기열 토큰 조회/검증 (`validateToken`, `getQueueStatus`)

| 항목 | 분석 |
|------|------|
| **호출 빈도** | 매우 높음 — 모든 API 요청마다 토큰 검증 |
| **데이터 변경 빈도** | 중간 — 상태 전이(WAITING→ACTIVE→EXPIRED)가 발생 |
| **캐시 적합성** | ✅ **이미 Redis로 구현됨** |

> 현재 `QueueRepositoryRedisImpl`에서 Redis를 직접 저장소로 사용 중이므로, 별도 캐시 레이어 불필요.

#### 좌석 예약 / 결제 처리

| 항목 | 분석 |
|------|------|
| **호출 빈도** | 중간 |
| **특성** | 쓰기 작업, 강한 일관성 필요 |
| **캐시 적합성** | ❌ **부적합** — 실시간 상태 확인이 필수 |

### 7-2. 캐시 전략 선정 요약

```
┌──────────────────┬──────────────────┬───────────────────────────┐
│   변경 빈도 낮음  │   변경 빈도 중간  │    변경 빈도 높음          │
├──────────────────┼──────────────────┼───────────────────────────┤
│ 콘서트 일정 조회  │ 대기열 토큰      │ 포인트 잔액               │
│ 좌석 목록 조회    │                  │ 예약 상태                 │
│                  │                  │ 결제 처리                 │
├──────────────────┼──────────────────┼───────────────────────────┤
│ ✅ Cache-Aside   │ ✅ Redis 저장소   │ ❌ 캐시 미적용 또는        │
│ 긴 TTL (분~시간) │ (이미 적용 완료)  │    Write-Through (짧은 TTL)│
└──────────────────┴──────────────────┴───────────────────────────┘
```

### 7-3. 대량 트래픽 시 지연 가능 쿼리 분석

| 쿼리 | 예상 지연 원인 | 대응 방안 |
|------|---------------|----------|
| `findSchedulesByConcertId` | 인기 콘서트 오픈 시 수만 건의 동시 조회 → DB 부하 | Redis 캐시 (Cache-Aside, TTL 10분) |
| `findAvailableSeats` | 좌석 조회 집중 시 DB 부하 | 좌석 마스터 캐시 + 예약 상태만 DB 조회 |
| `findSeatByScheduleAndNo` | 예약 요청마다 호출, 인기 좌석 집중 | 좌석 마스터 캐시 (불변 데이터) |
| `chargePoints` (UPSERT) | 이벤트 기간 동시 충전 몰림 | 분산락으로 직렬화 + 원자적 UPSERT |
| `findExpiredHeldReservations` | 10초마다 전체 스캔, 만료 건수 증가 시 부하 | 인덱스 `(status, expiresAt)` 활용 |

### 7-4. 캐시 적용 시 주의사항

1. **Cache Stampede 방지**: TTL 만료 시 다수의 요청이 동시에 DB를 조회하는 문제 → TTL에 랜덤 jitter 추가 또는 분산락으로 단일 갱신 보장
2. **데이터 정합성**: 쓰기 작업 후 반드시 캐시 무효화(invalidation) 수행 → 관리자가 일정을 수정하면 `cache:schedule:{concertId}` 삭제
3. **메모리 관리**: Redis 메모리 한계를 고려하여 `maxmemory-policy`(예: `allkeys-lru`) 설정
4. **직렬화 비용**: 복잡한 객체 캐시 시 JSON 직렬화/역직렬화 비용 고려

### 7-5. 캐시 구현 및 적용

**CacheService** (`src/infrastructure/cache/cache.service.ts`)에 Cache-Aside 패턴을 구현하고, **ConcertService**에 적용했습니다.

```typescript
// CacheService — Cache-Aside 패턴의 핵심 메서드
async getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T> {
  const cached = await this.get<T>(key);      // 1. 캐시 조회
  if (cached !== null) return cached;          // 2. HIT → 즉시 반환

  const data = await loader();                 // 3. MISS → DB 조회
  await this.set(key, data, ttlMs);            // 4. 결과를 캐시에 저장
  return data;
}
```

```typescript
// ConcertService — 캐시 적용
async getAvailableSchedules(concertId: string): Promise<ConcertSchedule[]> {
  return this.cacheService.getOrLoad(
    `schedule:${concertId}`,                              // 캐시 키
    () => this.concertRepository.findSchedulesByConcertId(concertId), // DB loader
    10 * 60 * 1000,                                       // TTL 10분
  );
}

async getAvailableSeats(scheduleId: string): Promise<Seat[]> {
  return this.cacheService.getOrLoad(
    `seats:${scheduleId}`,
    () => this.concertRepository.findAvailableSeats(scheduleId),
    24 * 60 * 60 * 1000,                                  // TTL 24시간 (불변 데이터)
  );
}
```

### 7-6. 성능 개선 측정 결과

테스트 파일: `test/it/cache.it.spec.ts`

Testcontainers 환경(MySQL 8 + Redis 7)에서 측정한 결과입니다.

#### 단건 조회 성능 비교

| 쿼리 | DB 평균 | 캐시 평균 | 개선율 |
|------|---------|----------|--------|
| **콘서트 일정 조회** (`getAvailableSchedules`) | 8.52ms | 1.78ms | **79.1%** |
| **좌석 목록 조회** (`getAvailableSeats`, 50건) | 9.99ms | 1.62ms | **83.8%** |

#### 대량 동시 조회 성능 비교

| 시나리오 | DB | 캐시 | 개선율 |
|---------|-----|------|--------|
| **100건 동시 조회** (일정 + 좌석) | 454.75ms | 12.17ms | **97.3%** |

#### 분석

- **단건 조회**: Redis 캐시 적용 시 DB 대비 약 **5~6배 빠른** 응답 속도
- **대량 동시 조회**: 캐시 적용 시 **97% 이상의 개선율** — DB 커넥션 부하를 근본적으로 제거
- 실제 프로덕션 환경(네트워크 지연, 더 큰 데이터셋)에서는 DB 쿼리의 지연이 더 커지므로 개선 효과가 더 극대화될 것으로 예상

#### 통합 테스트 결과 (6건 전체 PASS)

| 시나리오 | 결과 |
|---------|------|
| 첫 번째 조회는 DB, 이후는 캐시 (콘서트 일정) | ✅ PASS |
| 첫 번째 조회는 DB, 이후는 캐시 (좌석 목록) | ✅ PASS |
| 캐시 무효화 후 다시 DB에서 조회 | ✅ PASS |
| 콘서트 일정 조회 캐시 성능 개선 | ✅ PASS |
| 좌석 목록 조회 캐시 성능 개선 | ✅ PASS |
| 100건 동시 조회 캐시 성능 개선 | ✅ PASS |
