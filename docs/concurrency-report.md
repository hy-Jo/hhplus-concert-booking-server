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
