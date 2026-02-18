# DB 조회 성능 분석 및 인덱스 최적화 보고서

## 1. 현재 테이블 구조 및 인덱스 현황

| 테이블 | PK | 기존 인덱스 |
|--------|-----|------------|
| `concert` | `concertId (UUID)` | PK만 존재 |
| `concert_schedule` | `scheduleId (UUID)` | PK, FK(`concertId`) |
| `seat` | `seatId (UUID)` | PK, FK(`scheduleId`) |
| `reservation` | `reservationId (UUID)` | PK만 존재 |
| `payment` | `paymentId (UUID)` | PK, UNIQUE(`reservationId`) |
| `queue_token` | `tokenId (UUID)` | PK, UNIQUE(`tokenValue`) |
| `user_point_balance` | `userId (VARCHAR)` | PK만 존재 |
| `point_tx` | `txId (UUID)` | PK만 존재 |

---

## 2. 느린 조회 후보 분석

### 2-1. [위험도: 높음] 좌석 예약 시 중복 확인 — `reservation` 테이블

**쿼리 패턴:**
```sql
SELECT * FROM reservation
WHERE seatId = ? AND status IN ('HELD', 'CONFIRMED')
FOR UPDATE
```

**호출 위치:** `ReservationService.holdSeat()` (비관적 락 포함)

**문제점:**
- `seatId`, `status` 컬럼에 인덱스가 없어 **Full Table Scan** 발생
- `FOR UPDATE` 락과 결합되면, 테이블 스캔 중 불필요한 행까지 잠금 → **락 경합 증가**
- 예약 데이터가 누적될수록 성능 급격히 저하 (O(n))

**솔루션:**
```sql
CREATE INDEX idx_reservation_seat_status ON reservation (seatId, status);
```

**효과:** `seatId + status` 복합 인덱스로 정확한 행만 탐색 → 락 범위도 최소화

---

### 2-2. [위험도: 높음] 만료된 예약 조회 — `reservation` 테이블

**쿼리 패턴:**
```sql
SELECT * FROM reservation
WHERE status = 'HELD' AND expiresAt <= NOW()
```

**호출 위치:** `ReservationRepositoryImpl.findExpiredHeldReservations()`

**문제점:**
- 스케줄러가 주기적으로 호출하는 배치성 쿼리
- `status`와 `expiresAt`에 인덱스가 없어 매번 전체 테이블 스캔
- 예약 데이터가 수십만 건으로 늘어나면 배치 실행 시간 급증

**솔루션:**
```sql
CREATE INDEX idx_reservation_status_expires ON reservation (status, expiresAt);
```

**효과:** `status = 'HELD'`로 필터 후 `expiresAt` 범위 검색을 인덱스만으로 처리

---

### 2-3. [위험도: 높음] 만료된 토큰 조회 — `queue_token` 테이블

**쿼리 패턴:**
```sql
SELECT * FROM queue_token
WHERE status = 'ACTIVE' AND expiresAt <= NOW()
```

**호출 위치:** `QueueRepositoryImpl.findExpiredTokens()`

**문제점:**
- 만료 예약 조회와 동일한 패턴 — 스케줄러 배치 쿼리
- 대기열이 활발한 시간대에 `ACTIVE` 토큰이 수만 건 존재 가능
- 인덱스 없이 전체 스캔

**솔루션:**
```sql
CREATE INDEX idx_queue_token_status_expires ON queue_token (status, expiresAt);
```

---

### 2-4. [위험도: 중간] 대기열 WAITING 수 카운트 — `queue_token` 테이블

**쿼리 패턴:**
```sql
SELECT COUNT(*) FROM queue_token WHERE status = 'WAITING'
```

**호출 위치:** `QueueRepositoryImpl.countWaiting()`

**문제점:**
- 토큰 발급 시마다 호출되어 빈번한 쿼리
- `status` 단독 인덱스 없음 → Full Table Scan
- 위 2-3의 복합 인덱스 `(status, expiresAt)`가 있으면 `status` 단독 조회도 커버 가능 (leftmost prefix)

**솔루션:** 2-3의 인덱스로 함께 해결됨

---

### 2-5. [위험도: 중간] 좌석 조회 — `seat` 테이블

**쿼리 패턴:**
```sql
-- 특정 스케줄의 좌석 전체 조회
SELECT * FROM seat WHERE scheduleId = ? ORDER BY seatNo ASC

-- 특정 스케줄 + 좌석번호로 단건 조회
SELECT * FROM seat WHERE scheduleId = ? AND seatNo = ?
```

**호출 위치:** `ConcertRepositoryImpl.findAvailableSeats()`, `findSeatByScheduleAndNo()`

**문제점:**
- FK 인덱스(`scheduleId`)는 존재하지만 `seatNo`와의 복합 인덱스 없음
- 좌석 수가 스케줄당 50~100석이라 현재는 문제없으나, 대형 공연(수천석)에서는 정렬 비용 발생

**솔루션:**
```sql
CREATE UNIQUE INDEX idx_seat_schedule_no ON seat (scheduleId, seatNo);
```

**효과:** 단건 조회 시 인덱스로 즉시 탐색 + `ORDER BY seatNo` 정렬도 인덱스로 처리 + 데이터 무결성(중복 좌석 번호 방지)

---

### 2-6. [위험도: 중간] 유저별 토큰 조회 — `queue_token` 테이블

**쿼리 패턴:**
```sql
SELECT * FROM queue_token WHERE userId = ? ORDER BY issuedAt DESC LIMIT 1
```

**호출 위치:** `QueueRepositoryImpl.findByUserId()`

**문제점:**
- `userId` 인덱스 없음 → Full Table Scan + Filesort
- 사용자가 대기열 상태 확인할 때마다 호출

**솔루션:**
```sql
CREATE INDEX idx_queue_token_user_issued ON queue_token (userId, issuedAt DESC);
```

---

### 2-7. [위험도: 낮음] 스케줄 조회, 포인트 조회

| 쿼리 | 현재 인덱스 | 비고 |
|------|------------|------|
| `concert_schedule WHERE concertId = ?` | FK 인덱스 존재 | 이미 커버됨 |
| `user_point_balance WHERE userId = ?` | PK 조회 | 이미 최적 |
| `payment WHERE reservationId = ?` | UNIQUE 인덱스 존재 | 이미 최적 |

---

## 3. 인덱스 적용 요약

### 3-1. 커버링 인덱스 설계

일반 인덱스는 조건에 맞는 행을 찾은 뒤 **클러스터드 인덱스(PK)로 다시 조회**(Random I/O)합니다.
커버링 인덱스는 SELECT에 필요한 컬럼까지 인덱스에 포함시켜 **인덱스만으로 결과를 반환**(Extra: `Using index`)합니다.

#### 반드시 추가해야 하는 인덱스 (높음)

```sql
-- 1. 좌석 예약 중복 확인 + 비관적 락 최적화
--    SELECT에서 주로 사용하는 userId, reservationId를 포함하여 커버링 인덱스화
CREATE INDEX idx_reservation_seat_status
    ON reservation (seatId, status, reservationId, userId);

-- 2. 만료 예약 배치 조회
--    배치에서 reservationId를 가져와 상태 업데이트하므로 포함
CREATE INDEX idx_reservation_status_expires
    ON reservation (status, expiresAt, reservationId);

-- 3. 만료 토큰 배치 조회 + WAITING 카운트
--    만료 토큰 조회 시 tokenId로 상태 업데이트, 카운트는 SELECT COUNT(*)이므로 추가 컬럼 불필요
CREATE INDEX idx_queue_token_status_expires
    ON queue_token (status, expiresAt, tokenId);
```

> **커버링 인덱스 적용 판단 기준**: SELECT 컬럼이 2~3개 이하이고 조회 빈도가 높은 쿼리에만 적용합니다.
> 포함 컬럼이 많아지면 인덱스 크기가 커져 쓰기 비용이 증가하므로, 모든 컬럼을 포함하는 것은 지양합니다.

#### 추가 권장 인덱스 (중간)

```sql
-- 4. 좌석 단건 조회 + 데이터 무결성
CREATE UNIQUE INDEX idx_seat_schedule_no
    ON seat (scheduleId, seatNo);

-- 5. 유저별 토큰 조회
CREATE INDEX idx_queue_token_user_issued
    ON queue_token (userId, issuedAt DESC);
```

### 3-2. 단계적 롤아웃 계획

인덱스를 한꺼번에 적용하면 테이블 락과 쓰기 성능 저하가 동시에 발생할 수 있습니다.
우선순위와 영향도를 기준으로 3단계로 나누어 적용합니다.

| 단계 | 인덱스 | 우선순위 근거 | 롤아웃 시점 |
|------|--------|-------------|-----------|
| **Phase 1** | `idx_reservation_seat_status` | 동시성 락 경합 해소 — 서비스 안정성 직결 | 즉시 (유휴시간) |
| **Phase 2** | `idx_reservation_status_expires`, `idx_queue_token_status_expires` | 배치 쿼리 최적화 — 스케줄러 지연 해소 | Phase 1 적용 후 1일 모니터링 뒤 |
| **Phase 3** | `idx_seat_schedule_no`, `idx_queue_token_user_issued` | 조회 편의 — 긴급도 낮음 | Phase 2 안정 확인 후 |

**각 Phase 적용 절차:**
```
1. 유휴시간(새벽)에 ALGORITHM=INPLACE로 온라인 DDL 실행
2. 적용 직후 EXPLAIN ANALYZE로 실행계획 변경 확인
3. 슬로우쿼리 로그 임계값 설정 (long_query_time = 0.1s)
4. 24시간 모니터링: 쿼리 응답시간, INSERT 처리량, 락 대기(innodb_row_lock_waits)
5. 이상 발견 시 DROP INDEX로 즉시 롤백
```

---

## 4. EXPLAIN 기반 실행계획 검증

인덱스 제안의 실제 효과를 검증하기 위해 대량 데이터(reservation 10만건, queue_token 5만건, seat 5천건)를 삽입한 후 EXPLAIN 분석을 수행합니다.
검증 테스트: `test/it/explain-analysis.it.spec.ts`

### 4-1. 검증 절차

```
1. Testcontainers로 MySQL 8 컨테이너 기동
2. 대량 샘플 데이터 삽입
3. 인덱스 없이 EXPLAIN 실행 → type=ALL (Full Table Scan) 확인
4. 인덱스 생성
5. 인덱스 적용 후 EXPLAIN 실행 → type 변경, rows 감소 확인
6. 실제 쿼리 실행시간 측정
```

### 4-2. 예상 EXPLAIN 결과 비교

#### reservation (seatId, status) — 좌석 예약 중복 확인

| | type | key | rows (추정) |
|---|---|---|---|
| **Before** | ALL | NULL | ~100,000 |
| **After** | ref | idx_reservation_seat_status | < 100 |

- **컬럼 순서 근거**: `seatId`가 카디널리티가 높고(5,000종류), `status`는 4종류로 낮음
- `seatId`를 선행 컬럼으로 두면 선택도(selectivity)가 높아 탐색 범위를 먼저 좁힘
- `FOR UPDATE` 락 범위도 인덱스 탐색 결과로 한정되어 락 경합 대폭 감소

#### reservation (status, expiresAt) — 만료 예약 배치 조회

| | type | key | rows (추정) |
|---|---|---|---|
| **Before** | ALL | NULL | ~100,000 |
| **After** | range | idx_reservation_status_expires | < 25,000 |

- **컬럼 순서 근거**: `status = 'HELD'`로 동등 조건 필터 후, `expiresAt <= NOW()` 범위 스캔
- 동등 조건 컬럼을 선행에 두면 범위 조건이 인덱스 B-Tree를 효율적으로 탐색

#### queue_token (status, expiresAt) — 만료 토큰 + WAITING 카운트

| | type | key | rows (추정) |
|---|---|---|---|
| **Before** | ALL | NULL | ~50,000 |
| **After (만료 토큰)** | range | idx_queue_token_status_expires | < 16,000 |
| **After (WAITING 카운트)** | ref | idx_queue_token_status_expires | < 16,000 |

- `status`가 선행 컬럼이므로 **leftmost prefix**로 `WHERE status = 'WAITING'` 단독 조회도 커버
- 하나의 인덱스로 두 가지 쿼리 패턴 모두 해결

#### seat (scheduleId, seatNo) — 좌석 단건 조회

| | type | key | rows (추정) |
|---|---|---|---|
| **Before** | ref | FK_scheduleId | ~50 |
| **After** | const | idx_seat_schedule_no | 1 |

- UNIQUE 복합 인덱스로 단건 조회 시 **const** 접근 (최적)
- 데이터 무결성도 함께 보장 (동일 스케줄 내 좌석번호 중복 방지)

### 4-3. 인덱스 카디널리티 및 컬럼 순서 정리

| 인덱스 | 선행 컬럼 | 후행 컬럼 | 순서 결정 근거 |
|--------|----------|----------|---------------|
| `idx_reservation_seat_status` | `seatId` (높음) | `status` (낮음) | 선택도 높은 컬럼 우선 → 탐색 범위 최소화 |
| `idx_reservation_status_expires` | `status` (동등) | `expiresAt` (범위) | 동등 조건 선행 → 범위 조건이 B-Tree 순차 탐색 |
| `idx_queue_token_status_expires` | `status` (동등) | `expiresAt` (범위) | 동등 + 범위 패턴, leftmost prefix로 카운트 쿼리 커버 |
| `idx_seat_schedule_no` | `scheduleId` | `seatNo` | UNIQUE 제약, ORDER BY seatNo 정렬도 인덱스 처리 |

### 4-4. 쓰기 비용 트레이드오프

| 테이블 | 추가 인덱스 수 | 쓰기 빈도 | 영향 평가 |
|--------|-------------|----------|----------|
| `reservation` | +2 | 높음 (예약마다 INSERT) | INSERT 시 인덱스 유지 비용 발생하나, 락 경합 감소 이득이 더 큼 |
| `queue_token` | +1 | 높음 (토큰 발급마다) | Redis 전환 시 DB는 이력용이므로 영향 미미 |
| `seat` | +1 | 낮음 (초기 세팅) | 거의 읽기 전용, 쓰기 비용 무시 가능 |

---

## 5. 테이블 재설계 고려사항

### 5-1. `reservation` 테이블 — 이력 분리

현재 `reservation` 테이블에 모든 상태(HELD, CONFIRMED, CANCELLED, EXPIRED)의 데이터가 섞여 있습니다.
서비스가 성장하면 대부분의 레코드가 EXPIRED/CANCELLED 상태로, 실제 활성 예약(HELD/CONFIRMED) 조회 시 불필요한 데이터를 탐색합니다.

**대안:** `reservation_history` 테이블 분리
- `reservation`: HELD, CONFIRMED 상태만 유지 (활성 데이터)
- `reservation_history`: EXPIRED, CANCELLED 상태를 이관 (이력 데이터)

이렇게 하면 활성 테이블의 크기가 작게 유지되어 비관적 락과 조회 성능 모두 개선됩니다.

#### 마이그레이션 계획

**Step 1. 이력 테이블 생성**
```sql
CREATE TABLE reservation_history LIKE reservation;
```

**Step 2. 기존 데이터 백필 (배치 이관)**
```sql
-- 서비스 영향 최소화를 위해 1만건씩 배치로 이관
INSERT INTO reservation_history
  SELECT * FROM reservation
  WHERE status IN ('EXPIRED', 'CANCELLED')
  LIMIT 10000;

DELETE FROM reservation
  WHERE status IN ('EXPIRED', 'CANCELLED')
  LIMIT 10000;

-- 위 두 쿼리를 데이터가 없을 때까지 반복
```

**Step 3. 애플리케이션 코드 변경**
- `findExpiredHeldReservations()` → 만료 처리 후 `reservation_history`로 INSERT + `reservation`에서 DELETE
- 이력 조회 API가 필요하면 `reservation_history`에서 조회하도록 별도 구현

**Step 4. 자동화 (정기 이관 스케줄러)**
```
매일 새벽 3시에 실행:
1. reservation에서 EXPIRED/CANCELLED 상태인 행을 reservation_history로 이관
2. 이관 완료된 행을 reservation에서 삭제
3. 이관 건수 로깅 및 모니터링 알림
```

**롤백 계획:** `reservation_history`에서 다시 `reservation`으로 INSERT하면 원복 가능. 이력 테이블은 삭제하지 않으므로 데이터 유실 위험 없음.

### 5-2. `queue_token` 테이블 — Redis 전환 (이미 진행 중)

현재 `QueueRepositoryRedisImpl`로 Redis 기반 구현이 존재합니다.
대기열은 TTL 기반 만료와 빈번한 카운트 연산이 핵심이므로 Redis Sorted Set이 최적입니다.
DB 테이블은 이력 보관용으로만 유지하면 됩니다.
