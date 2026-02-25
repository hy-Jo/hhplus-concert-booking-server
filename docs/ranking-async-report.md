# 랭킹 & 비동기 대기열 설계 보고서

## 목차
1. [빠른 매진 랭킹 (Ranking Design)](#1-빠른-매진-랭킹-ranking-design)
2. [비동기 대기열 (Asynchronous Design)](#2-비동기-대기열-asynchronous-design)
3. [회고](#3-회고)

---

## 1. 빠른 매진 랭킹 (Ranking Design)

### 1-1. 왜 Redis Sorted Set인가

랭킹 시스템을 설계하면서 가장 먼저 고민한 건 "어디에 랭킹 데이터를 저장할 것인가"였다.

DB에 집계 테이블을 두고 `ORDER BY`로 뽑는 방법도 있지만, 매 결제마다 집계 쿼리를 날리면 부하가 만만치 않다. 특히 "실시간 인기 랭킹"은 조회 빈도가 높을 수밖에 없어서, DB보다는 인메모리 저장소가 적합하다고 판단했다.

Redis의 Sorted Set(ZSET)을 선택한 이유는 명확하다:
- `ZINCRBY` — O(log N)으로 점수 증가. 결제 때마다 예약 수를 +1 하기에 딱 맞는다
- `ZRANGE`/`ZREVRANGE` — O(log N + M)으로 랭킹 조회. 상위 N개를 score 기준으로 바로 뽑을 수 있다
- 별도의 정렬 로직 없이 Redis가 알아서 score 기준으로 정렬을 유지해준다

### 1-2. Redis 키 설계

```
ranking:reservation-count    (ZSET)   — member: scheduleId, score: 확정 예약 수
ranking:sold-out-speed       (ZSET)   — member: scheduleId, score: 매진 소요 시간(초)
ranking:first-reservation:{scheduleId} (STRING) — 해당 스케줄의 첫 예약 시각(ms)
```

키를 이렇게 나눈 이유가 있다. `reservation-count`는 "예약이 많은 순"으로 인기도를 보여주고, `sold-out-speed`는 "가장 빨리 매진된 순"으로 화제성을 보여준다. 두 가지 관점의 랭킹을 모두 제공하고 싶었다.

`first-reservation`은 매진 소요 시간을 계산하기 위해 필요하다. 첫 결제 시각을 기록해 두고, 50석이 다 찬 시점에서 차이를 계산하면 "얼마나 빨리 매진됐는가"를 알 수 있다.

### 1-3. 랭킹 갱신 흐름

```
결제 성공 (PaymentService.processPayment)
  │
  ├─ reservation.status = CONFIRMED
  │
  └─ updateRanking(seatId)  ← 비동기, 실패해도 결제에 영향 없음
       │
       ├─ seatId → scheduleId 조회
       │
       └─ RankingService.onReservationConfirmed(scheduleId)
            │
            ├─ SET ranking:first-reservation:{scheduleId} {now} NX
            │   └─ NX: 첫 예약 시각만 기록, 이후엔 무시
            │
            ├─ ZINCRBY ranking:reservation-count {scheduleId} 1
            │   └─ 확정 예약 수 +1
            │
            └─ if (count >= 50)  ← 매진 판정
                 └─ ZADD ranking:sold-out-speed NX {duration} {scheduleId}
                      └─ NX: 최초 매진 기록만 저장
```

핵심 설계 포인트가 두 가지 있다.

첫째, **랭킹 갱신은 결제 트랜잭션과 분리**했다. `this.updateRanking().catch(() => {})`로 비동기 호출하기 때문에, 랭킹 Redis에 문제가 생겨도 결제 자체는 정상 처리된다. 랭킹은 부가 기능이니까, 핵심 비즈니스 로직에 영향을 주면 안 된다고 생각했다.

둘째, `SET NX`와 `ZADD NX`를 적극 활용했다. 동시에 여러 결제가 들어와도 첫 예약 시각이 덮어씌워지거나 매진 기록이 중복 저장되지 않는다. Redis의 원자적 연산 덕분에 별도 분산락 없이도 데이터 정합성을 지킬 수 있었다.

### 1-4. API 엔드포인트

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /api/rankings/sold-out?limit=10` | 매진 속도 랭킹 (빠른 순) |
| `GET /api/rankings/popular?limit=10` | 인기 콘서트 랭킹 (예약 많은 순) |

응답 예시 (매진 속도 랭킹):
```json
{
  "rankings": [
    {
      "rank": 1,
      "scheduleId": "schedule-001",
      "concertTitle": "2024 연말 콘서트",
      "concertDate": "2024-12-25",
      "soldOutDurationSec": 30.5
    }
  ]
}
```

### 1-5. 테스트 결과

**단위 테스트 (7개 — 전체 통과)**

| 테스트 | 검증 내용 |
|-------|----------|
| 결제 확정 시 예약 수 +1 | ZINCRBY 호출 확인 |
| 첫 예약 시 시각 NX 기록 | SET NX 호출 확인 |
| 50번째 예약 시 매진 소요 시간 기록 | ZADD NX 호출 및 duration 정확도 검증 |
| 49석 이하에서는 매진 미기록 | ZADD 미호출 확인 |
| 매진 속도 랭킹 조회 | ZRANGE + Concert 정보 결합 |
| 빈 랭킹 조회 | 빈 배열 반환 |
| 인기 랭킹 내림차순 조회 | ZREVRANGE + 다중 스케줄 정렬 검증 |

---

## 2. 비동기 대기열 (Asynchronous Design)

### 2-1. 기존 구현의 문제점

기존 대기열 시스템은 Redis 기반으로 잘 구현되어 있었지만, 한 가지 치명적인 빈틈이 있었다. **WAITING → ACTIVE 자동 전환 로직이 없었다.** 유저가 토큰을 발급받으면 WAITING 상태로 들어가는데, 이걸 ACTIVE로 바꿔줄 주체가 없었던 것이다.

결국 토큰이 10분 TTL 동안 WAITING 상태로 머물다가 그냥 만료되는 구조였다.

### 2-2. 해결 방안: 스케줄러 기반 비동기 큐 프로세싱

토큰 라이프사이클을 완성하기 위해 `QueueScheduler`를 도입했다.

```
[유저 토큰 발급]
     │
     ▼
  WAITING  ─── queue:waiting (Sorted Set, score = issuedAt)
     │
     │  ◀── QueueScheduler: 5초마다 activateTokens() 실행
     │      "빈 자리 수(MAX 50 - 현재 ACTIVE)만큼 가장 오래 기다린 순서로 활성화"
     ▼
  ACTIVE   ─── queue:active (Sorted Set, score = activatedAt)
     │
     │  ◀── 10분 TTL 만료 또는 expireToken() 호출
     │  ◀── QueueScheduler: 30초마다 cleanupExpiredTokens() 실행
     ▼
  EXPIRED  ─── Redis에서 제거
     │
     └── 빈 자리 발생 → 다음 WAITING 토큰 활성화 (순환)
```

### 2-3. 핵심 구현: Redis Sorted Set 이중 관리

기존에는 `queue:waiting` Sorted Set 하나만 사용했는데, `queue:active` Sorted Set을 추가해서 현재 활성 토큰 수를 O(1)로 파악할 수 있게 했다.

```
queue:waiting   ZSET  — score: issuedAt   → FIFO 순서 보장
queue:active    ZSET  — score: activatedAt → ACTIVE 토큰 수 추적 (ZCARD)
```

`activateNextTokens(count)` 구현이 핵심인데, 동작 순서는 이렇다:

```typescript
// 1. WAITING Set에서 가장 앞(오래된)의 N개 토큰을 조회
const tokenValues = await redis.zrange('queue:waiting', 0, count - 1);

// 2. 각 토큰을 ACTIVE로 전환
for (const tokenValue of tokenValues) {
  // Hash의 status를 ACTIVE로 변경
  await redis.hset(tokenKey, 'status', 'ACTIVE');
  // 만료 시간을 ACTIVE 시점부터 10분으로 갱신
  await redis.hset(tokenKey, 'expiresAt', newExpiresAt);
  await redis.expire(tokenKey, TTL_SECONDS);
  // Active Set에 추가
  await redis.zadd('queue:active', Date.now(), tokenValue);
  // Waiting Set에서 제거
  await redis.zrem('queue:waiting', tokenValue);
}
```

여기서 고민했던 부분이 있다. ACTIVE로 전환할 때 **만료 시간을 갱신**해야 하는가? 갱신하지 않으면 WAITING에서 오래 기다린 유저는 ACTIVE가 되자마자 곧바로 만료될 수도 있다. 그래서 ACTIVE 전환 시점부터 새로 10분을 부여하도록 했다. 공정한 사용 시간을 보장하는 게 맞다고 판단했다.

### 2-4. 동시 활성 토큰 제한 (MAX_ACTIVE_TOKENS = 50)

대기열의 존재 이유는 "동시 접속자 수를 제어하는 것"이다. 한꺼번에 모든 유저를 ACTIVE로 바꿔버리면 대기열이 무의미해진다.

```typescript
async activateTokens(): Promise<number> {
  const activeCount = await this.queueRepository.countActive();    // ZCARD — O(1)
  const slotsAvailable = MAX_ACTIVE_TOKENS - activeCount;

  if (slotsAvailable <= 0) return 0;                               // 빈 자리 없으면 패스

  return this.queueRepository.activateNextTokens(slotsAvailable);  // 빈 자리만큼만 활성화
}
```

`ZCARD`는 O(1)이라서 5초마다 호출해도 부담이 없다. ACTIVE 토큰이 만료되거나 명시적으로 `expireToken()`이 호출되면 Active Set에서 제거되고, 다음 스케줄러 사이클에서 WAITING 토큰이 빈 자리를 채운다.

### 2-5. 스케줄러 주기 선택 근거

| 스케줄러 | 주기 | 이유 |
|---------|------|------|
| `activateWaitingTokens` | 5초 | 대기 중인 유저가 너무 오래 기다리면 UX가 나쁘다. 5초면 체감상 "바로" 수준 |
| `cleanupExpiredTokens` | 30초 | 만료 토큰 정리는 급하지 않다. Redis TTL이 1차 방어선이고, 정리는 2차 |

### 2-6. 테스트 결과

**단위 테스트 (16개 — 전체 통과)**

| 테스트 영역 | 테스트 수 | 검증 내용 |
|------------|----------|----------|
| issueToken | 2 | 토큰 발급, 중복 발급 방지 |
| validateToken | 4 | ACTIVE 통과, WAITING/EXPIRED/미존재 거부 |
| getQueueStatus | 3 | 대기 위치, ACTIVE position=0, 미존재 |
| expireToken | 2 | 만료 처리, 미존재 토큰 예외 |
| activateTokens | 3 | MAX 미만 시 활성화, MAX 도달 시 미활성, 빈 큐 |
| cleanupExpiredTokens | 2 | 만료 토큰 정리, 빈 결과 |

---

## 3. 회고

### 3-1. 잘된 점

**Redis의 자료구조를 적재적소에 활용한 것**이 이번 과제에서 가장 만족스러운 부분이다.

랭킹에는 ZSET의 `ZINCRBY`와 `ZRANGE`를, 대기열에는 ZSET의 `ZCARD`와 `ZRANGEBYSCORE`를, 첫 예약 시각 기록에는 STRING의 `SET NX`를 사용했다. 각각의 Redis 명령어가 어떤 시간복잡도를 갖고 있고, 어떤 원자성을 보장하는지 이해한 상태에서 설계했기 때문에 불필요한 분산락 없이도 정합성을 유지할 수 있었다.

또한 **랭킹 갱신을 결제 트랜잭션에서 분리한 설계 판단**도 잘한 것 같다. `catch(() => {})`로 에러를 삼키는 게 얼핏 보면 안티패턴 같지만, 랭킹이라는 부가 기능이 결제라는 핵심 기능의 안정성을 해치면 안 된다는 원칙에서 나온 선택이다. 물론 실제 프로덕션이라면 에러 로깅은 추가해야 한다.

### 3-2. 아쉬운 점과 개선 방향

**첫째, `activateNextTokens`에서 개별 Redis 명령어를 for 루프로 돌리고 있다.**

현재 구현은 N개의 토큰을 전환할 때 토큰당 5~6번의 Redis 호출이 발생한다. 50개를 한 번에 전환하면 약 250~300번의 Redis 왕복이 생기는 셈이다. Lua 스크립트로 한 번에 처리하거나, 최소한 Redis Pipeline으로 묶으면 네트워크 라운드트립을 대폭 줄일 수 있다.

```lua
-- 이상적인 Lua 스크립트 (향후 개선)
local tokens = redis.call('ZRANGE', 'queue:waiting', 0, count - 1)
for _, tokenValue in ipairs(tokens) do
  redis.call('HSET', tokenKey, 'status', 'ACTIVE')
  redis.call('ZADD', 'queue:active', now, tokenValue)
  redis.call('ZREM', 'queue:waiting', tokenValue)
end
```

**둘째, 랭킹 조회 시 DB 조회가 N+1 패턴이다.**

현재 `enrichWithConcertInfo()`는 ZSET 결과의 각 scheduleId마다 `findScheduleWithConcert()`를 개별 호출한다. Top 10을 뽑으면 10번의 DB 쿼리가 발생한다. `WHERE scheduleId IN (...)` 같은 벌크 조회로 바꾸거나, 랭킹 조회용 캐시를 따로 두면 성능이 개선될 것이다.

**셋째, 대기열 스케줄러의 다중 인스턴스 환경 대응이 안 되어 있다.**

현재 `@Interval(5_000)`으로 스케줄러를 걸면, 인스턴스가 3대일 경우 5초마다 3번씩 `activateTokens()`가 호출된다. Redis의 원자적 연산 덕분에 데이터가 깨지진 않지만, 불필요한 중복 작업이 발생한다. 분산 락으로 스케줄러를 감싸거나, 별도의 워커 프로세스로 분리하는 것이 바람직하다.

### 3-3. 배운 점

이번 과제를 진행하면서 확실히 느낀 건, **Redis는 단순한 캐시가 아니라 다양한 자료구조를 제공하는 인메모리 데이터 스토어**라는 점이다.

이전 주차에서는 캐시(String)와 분산락(String + NX)만 사용했는데, 이번에 ZSET을 본격적으로 활용하면서 Redis의 진가를 체감했다. 특히 Sorted Set이 삽입·삭제·범위 조회를 모두 O(log N)에 처리한다는 점이, 랭킹과 대기열 같은 "정렬이 필요한 실시간 데이터"에 얼마나 잘 맞는지 실감했다.

또한 "부가 기능과 핵심 기능의 경계"를 의식하게 된 것도 수확이다. 랭킹 갱신이 실패했을 때 결제가 롤백되면 안 된다는 건 당연한데, 실제 코드에서 이걸 구현하려면 트랜잭션 경계를 어디까지 잡을지, 에러를 어떻게 처리할지 구체적인 판단이 필요하다. 이런 판단력은 직접 부딪혀봐야 느는 것 같다.

---

## 부록: 수정된 파일 목록

### Ranking Design

| 구분 | 파일 | 설명 |
|------|------|------|
| 신규 | `src/ranking/ranking.service.ts` | Redis ZSET 기반 랭킹 핵심 로직 |
| 신규 | `src/ranking/ranking.module.ts` | NestJS 모듈 |
| 신규 | `src/interfaces/controllers/ranking.controller.ts` | 랭킹 API 엔드포인트 |
| 신규 | `src/interfaces/dto/ranking.dto.ts` | 응답 DTO |
| 신규 | `src/ranking/ranking.service.spec.ts` | 단위 테스트 (7개) |
| 신규 | `test/it/ranking.it.spec.ts` | 통합 테스트 (6개) |
| 수정 | `src/payment/payment.service.ts` | 결제 확정 시 랭킹 갱신 호출 |
| 수정 | `src/payment/payment.module.ts` | RankingModule, ConcertModule import |
| 수정 | `src/app.module.ts` | RankingModule 등록 |
| 수정 | `src/concert/concert.repository.ts` | `findScheduleWithConcert`, `findScheduleIdBySeatId` 추가 |
| 수정 | `src/infrastructure/persistence/concert/concert.repository.impl.ts` | 위 메서드 구현체 |

### Asynchronous Design

| 구분 | 파일 | 설명 |
|------|------|------|
| 신규 | `src/queue/queue.scheduler.ts` | 5초/30초 주기 비동기 스케줄러 |
| 신규 | `test/it/queue-async.it.spec.ts` | 통합 테스트 (7개) |
| 수정 | `src/queue/queue.repository.ts` | `countActive()`, `activateNextTokens()` 인터페이스 추가 |
| 수정 | `src/queue/queue.service.ts` | `activateTokens()`, `cleanupExpiredTokens()` 로직 추가 |
| 수정 | `src/queue/queue.module.ts` | QueueScheduler 등록 |
| 수정 | `src/infrastructure/persistence/queue/queue.repository.redis-impl.ts` | Active Set 관리, 배치 활성화 구현 |
| 수정 | `src/infrastructure/persistence/queue/queue.repository.impl.ts` | TypeORM 구현체 동기화 |
| 수정 | `src/queue/queue.service.spec.ts` | 새 테스트 5개 추가 |
