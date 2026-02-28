# MSA 전환 설계 — 도메인 분리와 트랜잭션 한계 분석

## 목차
1. [현재 아키텍처 분석](#1-현재-아키텍처-분석)
2. [MSA 도메인 분리 설계](#2-msa-도메인-분리-설계)
3. [트랜잭션 한계와 해결 방안](#3-트랜잭션-한계와-해결-방안)
4. [이벤트 기반 관심사 분리 (적용 완료)](#4-이벤트-기반-관심사-분리-적용-완료)
5. [정리](#5-정리)

---

## 1. 현재 아키텍처 분석

### 1-1. 도메인 구조

현재 콘서트 예약 서비스는 모놀리식 NestJS 애플리케이션으로, 6개의 도메인 모듈이 하나의 프로세스 안에서 동작한다.

```
┌─────────────────────────────────────────────────────┐
│                    Monolith (NestJS)                 │
│                                                     │
│  ┌──────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ Concert  │  │ Reservation │  │   Payment     │  │
│  │ (카탈로그)│  │  (좌석 예약) │  │   (결제)      │  │
│  └──────────┘  └─────────────┘  └───────────────┘  │
│  ┌──────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │  Queue   │  │   Point     │  │   Ranking     │  │
│  │ (대기열)  │  │  (포인트)    │  │   (랭킹)      │  │
│  └──────────┘  └─────────────┘  └───────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │        Shared Infrastructure                │    │
│  │   MySQL (단일 DB)  │  Redis (락/캐시/큐)     │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 1-2. 도메인 간 의존 관계

```
Payment ──→ Point       (동기 호출, 같은 트랜잭션 내 포인트 차감)
Payment ──→ Reservation (직접 엔티티 조회/수정, EntityManager 사용)
Payment ──→ Ranking     (이벤트 기반, 트랜잭션 밖)    ← 이번 주차에 분리 완료
Payment ──→ DataPlatform(이벤트 기반, 트랜잭션 밖)    ← 이번 주차에 추가

Reservation ──→ Concert (좌석 조회, 읽기 전용)
Ranking     ──→ Concert (스케줄 정보 조회, 읽기 전용)

Queue   ──→ (독립)
Point   ──→ (독립)
Concert ──→ (독립)
```

### 1-3. 가장 큰 문제: 결제 트랜잭션의 범위

현재 `PaymentService.processPayment()`에서 **하나의 DB 트랜잭션 안에 3개 도메인의 로직이 묶여 있다.**

```typescript
return this.dataSource.transaction(async (manager) => {
  // 1. Reservation 도메인: 예약 조회 및 상태 검증
  const reservation = await manager.findOne(Reservation, { where: { reservationId } });

  // 2. Payment 도메인: 결제 생성
  const saved = await manager.save(payment);

  // 3. Point 도메인: 포인트 차감 (내부에서 또 다른 분산락 + 트랜잭션)
  await this.pointService.usePoints(userId, amount, saved.paymentId);

  // 4. Reservation 도메인: 예약 상태 변경
  reservation.status = ReservationStatus.CONFIRMED;
  await manager.save(reservation);
});
```

이 구조가 모놀리식에서는 문제가 안 되지만, MSA로 분리하면 각 도메인이 **별도의 DB를 갖게 되므로** 단일 트랜잭션으로 묶을 수 없게 된다. 이것이 핵심 문제다.

---

## 2. MSA 도메인 분리 설계

### 2-1. 배포 단위 설계

서비스를 5개의 배포 단위로 분리한다. 각 서비스는 독립된 DB를 갖고, API 또는 이벤트를 통해 통신한다.

```
┌────────────┐  ┌────────────────┐  ┌──────────────┐
│  Concert   │  │  Reservation   │  │   Payment    │
│  Service   │  │    Service     │  │   Service    │
│            │  │                │  │              │
│ [MySQL-1]  │  │   [MySQL-2]    │  │  [MySQL-3]   │
└────────────┘  └────────────────┘  └──────────────┘

┌────────────┐  ┌────────────────┐
│   Point    │  │ Queue/Ranking  │
│  Service   │  │   Service      │
│            │  │                │
│ [MySQL-4]  │  │   [Redis]      │
└────────────┘  └────────────────┘

         ┌─────────────────────┐
         │  Message Broker     │
         │  (Kafka / RabbitMQ) │
         └─────────────────────┘
```

| 서비스 | 엔티티 | DB | 특성 |
|--------|--------|-----|------|
| **Concert Service** | Concert, ConcertSchedule, Seat | MySQL-1 | 읽기 위주, 마스터 데이터 관리 |
| **Reservation Service** | Reservation | MySQL-2 | 좌석 예약/만료, 시간 제한(5분) |
| **Payment Service** | Payment | MySQL-3 | 결제 처리, 오케스트레이터 역할 |
| **Point Service** | UserPointBalance, PointTransaction | MySQL-4 | 금융 도메인, 강한 정합성 필요 |
| **Queue/Ranking Service** | QueueToken, 랭킹 데이터 | Redis | 인메모리 처리, 독립적 |

### 2-2. 분리 근거

**Concert Service** — 콘서트/스케줄/좌석은 관리자가 등록하는 마스터 데이터다. 변경 빈도가 낮고, 다른 도메인에서는 읽기만 한다. 캐시를 적극 활용할 수 있어 독립 서비스로 분리하기에 가장 적합하다.

**Reservation Service** — 좌석 예약은 높은 동시성을 처리해야 하고, 5분 만료라는 독자적인 생명주기를 갖는다. 스케줄러도 자체적으로 운영하므로 독립 배포가 자연스럽다.

**Payment Service** — 결제는 비즈니스 흐름의 중심이다. 예약 확정, 포인트 차감, 이벤트 발행 등 여러 도메인을 조율(orchestrate)하는 역할을 담당한다.

**Point Service** — 금융 도메인은 정합성이 생명이다. 잔액 관리와 거래 이력(point_tx)은 감사 추적(audit trail)이 필요하므로 독립 서비스로 관리하는 게 안전하다.

**Queue/Ranking Service** — 둘 다 Redis 기반이고, MySQL 의존이 없다(Ranking의 Concert 조회는 API 호출로 대체 가능). 인메모리 처리 특성상 함께 묶는 것이 효율적이다.

---

## 3. 트랜잭션 한계와 해결 방안

### 3-1. 핵심 문제: 분산 트랜잭션

모놀리식에서는 하나의 DB 트랜잭션으로 원자성을 보장했다.

```
[모놀리식]
BEGIN TRANSACTION
  ├─ Payment INSERT       ← MySQL (같은 DB)
  ├─ Point UPDATE          ← MySQL (같은 DB)
  └─ Reservation UPDATE   ← MySQL (같은 DB)
COMMIT  ← 전부 성공하거나 전부 롤백
```

MSA로 분리하면 각 서비스가 자기 DB에만 접근할 수 있으므로, **단일 트랜잭션이 불가능**하다.

```
[MSA]
Payment Service → Payment DB    : INSERT  ✓
Payment Service → Point Service  : API 호출 ... 실패하면?
Payment Service → Reservation Service : API 호출 ... 여기서 실패하면?
```

중간에 실패하면 이미 커밋된 DB를 롤백할 수 없다. 이것이 분산 트랜잭션의 본질적 한계다.

### 3-2. 해결 방안 1: Saga 패턴 (Orchestration)

Payment Service가 오케스트레이터 역할을 하며, 각 단계를 순차적으로 실행하고 실패 시 **보상 트랜잭션(Compensating Transaction)**을 실행한다.

```
[결제 Saga — 정상 흐름]
Payment Service (Orchestrator)
  │
  ├─ Step 1: 포인트 차감 요청   → Point Service
  │           ✓ 성공
  │
  ├─ Step 2: 예약 확정 요청     → Reservation Service
  │           ✓ 성공
  │
  └─ Step 3: 결제 기록 저장     → Payment DB
              ✓ 완료
```

```
[결제 Saga — 실패 흐름 (Step 2에서 실패)]
Payment Service (Orchestrator)
  │
  ├─ Step 1: 포인트 차감 요청   → Point Service
  │           ✓ 성공
  │
  ├─ Step 2: 예약 확정 요청     → Reservation Service
  │           ✗ 실패 (예약 만료됨)
  │
  └─ Compensate Step 1: 포인트 환불 → Point Service
              ✓ 보상 완료
```

**장점:**
- 흐름이 명확하고 추적이 쉽다
- 실패 지점에서 어디까지 보상해야 하는지 오케스트레이터가 알고 있다

**단점:**
- 오케스트레이터(Payment Service)에 로직이 집중된다
- 보상 트랜잭션을 모든 단계에 대해 구현해야 한다

**구현 예시:**
```typescript
// Payment Service (Orchestrator)
async processPayment(userId: string, reservationId: string, amount: number) {
  // Step 1: 포인트 차감
  const pointTxId = await this.pointClient.usePoints(userId, amount);

  try {
    // Step 2: 예약 확정
    await this.reservationClient.confirm(reservationId, userId);
  } catch (error) {
    // 보상: 포인트 환불
    await this.pointClient.refundPoints(pointTxId);
    throw error;
  }

  // Step 3: 결제 기록
  return this.paymentRepository.save(payment);
}
```

### 3-3. 해결 방안 2: Saga 패턴 (Choreography)

중앙 오케스트레이터 없이, 각 서비스가 이벤트를 발행하고 구독하여 자율적으로 처리한다.

```
Payment Service                     Point Service                Reservation Service
     │                                    │                            │
     ├─ PaymentCreated 이벤트 발행 ──→    │                            │
     │                              포인트 차감                        │
     │                              PointDeducted 이벤트 발행 ───→    │
     │                                    │                     예약 확정
     │                                    │              ReservationConfirmed 발행
     │  ◀──────────────────────────────────┼──────────────────────────┤
     │  결제 완료 처리                      │                            │
```

**장점:**
- 서비스 간 결합도가 가장 낮다
- 새로운 서비스 추가가 쉽다 (이벤트만 구독하면 됨)

**단점:**
- 전체 흐름을 파악하기 어렵다 (이벤트가 여기저기 흩어짐)
- 실패 시 보상 로직이 복잡해진다
- 순환 이벤트, 이벤트 순서 문제 등 디버깅이 까다롭다

### 3-4. 해결 방안 3: Outbox 패턴 + 이벤트 기반

DB에 이벤트를 함께 저장하여 **"로컬 트랜잭션 + 이벤트 발행"의 원자성**을 보장하는 패턴이다.

```
Payment Service
  │
  ├─ BEGIN TRANSACTION
  │    ├─ INSERT payment
  │    └─ INSERT outbox_events (event_type, payload, status='PENDING')
  │  COMMIT
  │
  └─ [비동기] Outbox Poller
       ├─ SELECT * FROM outbox_events WHERE status = 'PENDING'
       ├─ 메시지 브로커로 발행
       └─ UPDATE status = 'PUBLISHED'
```

**장점:**
- 이벤트 유실 방지 (DB에 저장되므로)
- 최소 1회 전달(at-least-once) 보장
- 로컬 트랜잭션만 사용하므로 분산 트랜잭션 불필요

**단점:**
- Outbox 테이블 관리 + Poller 구현 필요
- 이벤트 중복 처리를 위한 멱등성(idempotency) 구현 필요

### 3-5. 우리 서비스에 적합한 전략

결론적으로, **Orchestration Saga + Outbox 패턴의 조합**이 가장 적합하다고 판단했다.

| 기준 | 이유 |
|------|------|
| **결제 흐름은 Orchestration Saga** | 결제 → 포인트 차감 → 예약 확정은 순서가 명확하고, 실패 시 보상 로직도 직관적이다. Choreography로 하면 흐름 추적이 너무 어려워진다 |
| **이벤트 발행은 Outbox 패턴** | 결제 완료 후 랭킹 갱신, 데이터 플랫폼 전송 같은 부가 작업은 이벤트로 처리하되, 이벤트 유실을 방지하기 위해 Outbox에 저장한다 |
| **부가 작업은 Eventual Consistency** | 랭킹, 알림, 데이터 플랫폼 전송은 즉시 처리되지 않아도 된다. 결제 정합성만 보장하면 나머지는 최종적 일관성으로 충분하다 |

```
[최종 설계]

                    ┌─────────────────────────────────────┐
                    │         Payment Service              │
                    │         (Orchestrator)               │
                    │                                     │
                    │  1. Point 차감 ──→ Point Service     │
                    │  2. 예약 확정 ──→ Reservation Service │
                    │  3. 결제 저장 + Outbox INSERT         │
                    │     (같은 트랜잭션)                    │
                    └─────────┬───────────────────────────┘
                              │
                     [Outbox Poller]
                              │
                    ┌─────────▼───────────┐
                    │    Message Broker    │
                    │   (Kafka/RabbitMQ)   │
                    └──┬──────────┬───────┘
                       │          │
              ┌────────▼──┐  ┌───▼──────────┐
              │  Ranking  │  │ DataPlatform  │
              │  Service  │  │   Service     │
              └───────────┘  └──────────────┘
```

---

## 4. 이벤트 기반 관심사 분리 (적용 완료)

### 4-1. 이번 주차에서 실제로 한 것

3장에서 설명한 MSA 전환은 미래의 일이지만, 그 첫 단계로 **이벤트를 활용한 관심사 분리**를 현재 모놀리식 코드에 적용했다.

**Before — 직접 의존:**
```typescript
// PaymentService가 RankingService, ConcertRepository를 직접 알고 있음
constructor(
  private readonly concertRepository: ConcertRepository,    // 강결합
  private readonly rankingService: RankingService,           // 강결합
  ...
) {}

// 트랜잭션 내부에서 랭킹 갱신
this.updateRanking(reservation.seatId).catch(() => {});
```

**After — 이벤트 기반 분리:**
```typescript
// PaymentService는 EventEmitter2만 알면 됨
constructor(
  private readonly eventEmitter: EventEmitter2,  // 느슨한 결합
  ...
) {}

// 트랜잭션 완료 후 이벤트 발행
this.eventEmitter.emit(
  PaymentCompletedEvent.EVENT_NAME,
  new PaymentCompletedEvent(paymentId, userId, reservationId, seatId, amount),
);
```

```typescript
// PaymentEventHandler — 이벤트 소비자
@OnEvent('payment.completed')
async handleRankingUpdate(event: PaymentCompletedEvent) { ... }

@OnEvent('payment.completed')
async handleDataPlatformNotification(event: PaymentCompletedEvent) { ... }
```

### 4-2. 이 분리가 MSA 전환에 주는 의미

현재는 in-process 이벤트(`@nestjs/event-emitter`)를 사용하지만, MSA 전환 시에는 `EventEmitter2.emit()`을 **메시지 브로커(Kafka/RabbitMQ) 발행**으로 교체하기만 하면 된다.

```
[현재]  PaymentService → EventEmitter2.emit() → 같은 프로세스 내 핸들러
[MSA]   PaymentService → Kafka.produce()      → 별도 서비스의 컨슈머
```

이벤트 클래스(`PaymentCompletedEvent`)와 핸들러의 비즈니스 로직은 그대로 재사용할 수 있다. 인프라 레이어만 교체하는 셈이다.

---

## 5. 정리

### 5-1. 도메인 분리 요약

| 서비스 | 핵심 책임 | DB | 정합성 수준 |
|--------|-----------|-----|------------|
| Concert | 콘서트/스케줄/좌석 마스터 데이터 | MySQL-1 | 강한 일관성 |
| Reservation | 좌석 예약, 5분 만료 관리 | MySQL-2 | 강한 일관성 |
| Payment | 결제 처리, 흐름 조율 | MySQL-3 | 강한 일관성 (Saga) |
| Point | 포인트 잔액, 거래 이력 | MySQL-4 | 강한 일관성 |
| Queue/Ranking | 대기열, 랭킹 | Redis | 최종적 일관성 |

### 5-2. 분산 트랜잭션 해결 전략

| 구간 | 전략 | 보상 방안 |
|------|------|----------|
| Payment → Point | Saga (Orchestration) | 포인트 환불 API |
| Payment → Reservation | Saga (Orchestration) | 예약 상태 원복 API |
| Payment → Ranking/DataPlatform | 이벤트 (Outbox) | 재처리 (멱등성) |

### 5-3. 현재 적용 상태

| 항목 | 상태 |
|------|------|
| 이벤트 기반 관심사 분리 | ✅ 적용 완료 (`@nestjs/event-emitter`) |
| PaymentService에서 Ranking 의존성 제거 | ✅ 완료 |
| 데이터 플랫폼 Mock API 전송 | ✅ 완료 (이벤트 핸들러) |
| Saga 패턴 적용 | ⬜ MSA 전환 시 구현 예정 |
| Outbox 패턴 적용 | ⬜ MSA 전환 시 구현 예정 |
| 메시지 브로커 도입 | ⬜ MSA 전환 시 구현 예정 |
