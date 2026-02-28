# Kafka 기초 학습 및 활용

## 목차
1. [Kafka란 무엇인가?](#1-kafka란-무엇인가)
2. [Kafka의 주요 구성 요소](#2-kafka의-주요-구성-요소)
3. [Kafka의 핵심 기능](#3-kafka의-핵심-기능)
4. [Kafka의 장단점](#4-kafka의-장단점)
5. [이벤트 아이디어를 시스템 전체로 확장하기](#5-이벤트-아이디어를-시스템-전체로-확장하기)
6. [콘서트 예약 서비스에 Kafka 적용하기](#6-콘서트-예약-서비스에-kafka-적용하기)
7. [정리](#7-정리)

---

## 1. Kafka란 무엇인가?

### 1-1. Kafka의 정의

**Apache Kafka**는 LinkedIn에서 개발하고 Apache 재단에 기부한 **분산 이벤트 스트리밍 플랫폼(Distributed Event Streaming Platform)**입니다.

```
전통적 메시지 브로커: RabbitMQ, ActiveMQ 등
           ↓
메시지를 받아서 전달하고 삭제 (일회성 처리)

Kafka:
           ↓
메시지를 받아서 디스크에 저장하고, 여러 컨슈머가 독립적으로 읽을 수 있음
```

### 1-2. 왜 Kafka가 필요한가?

**전통적인 아키텍처의 문제점:**

```
[Before]
┌─────────────┐     직접 호출      ┌──────────────┐
│   Service A │ ───────────────→  │   Service B   │
│             │ ◀───────────────  │               │
└─────────────┘    결과 반환       └──────────────┘
```

문제점:
- Service B가 죽으면 Service A도 영향을 받음 (강결합)
- 새로운 서비스를 추가하려면 모든 서비스를 수정해야 함
- 대량의 데이터를 실시간으로 처리하기 어려움

**Kafka를 사용한 아키텍처:**

```
[After]
┌─────────────┐                    ┌──────────────┐
│   Service A │ ─┐              ┌→ │   Service B   │
└─────────────┘  │              │  └──────────────┘
                 ▼              │
            ┌─────────┐         │  ┌──────────────┐
            │  Kafka  │ ────────┼→ │   Service C   │
            └─────────┘         │  └──────────────┘
                 ▲              │
┌─────────────┐  │              │  ┌──────────────┐
│   Service D │ ─┘              └→ │   Service E   │
└─────────────┘                    └──────────────┘
```

장점:
- 서비스 간 느슨한 결합 (Decoupling)
- 새로운 컨슈머 추가가 쉬움
- 메시지 영속성으로 데이터 유실 방지
- 높은 처리량 (초당 수백만 건)

---

## 2. Kafka의 주요 구성 요소

### 2-1. 핵심 용어 정리

```
┌──────────────────────────────────────────────────────┐
│                    Kafka Cluster                      │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Broker 1   │  │  Broker 2   │  │  Broker 3   │  │
│  │             │  │             │  │             │  │
│  │  Topic A    │  │  Topic A    │  │  Topic A    │  │
│  │  Partition0 │  │  Partition1 │  │  Partition2 │  │
│  │  Partition1 │  │  Partition2 │  │  Partition0 │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────┘
         ▲                                    │
         │                                    ▼
    ┌─────────┐                         ┌──────────┐
    │Producer │                         │ Consumer │
    └─────────┘                         └──────────┘
```

#### **1) Producer (생산자)**
- 메시지를 Kafka에 발행(publish)하는 클라이언트
- 어느 Topic의 어느 Partition에 보낼지 결정
- 예: 결제 서비스가 "결제 완료" 이벤트를 발행

#### **2) Consumer (소비자)**
- Kafka로부터 메시지를 구독(subscribe)하여 읽어가는 클라이언트
- 여러 Consumer가 하나의 Consumer Group을 구성할 수 있음
- 예: 랭킹 서비스, 데이터 플랫폼 서비스가 "결제 완료" 이벤트를 구독

#### **3) Topic (토픽)**
- 메시지가 저장되는 논리적 카테고리 (DB의 테이블과 유사)
- 예: `payment.completed`, `reservation.created`, `user.registered`

#### **4) Partition (파티션)**
- Topic을 물리적으로 분할한 단위
- 각 Partition은 순서가 보장된 불변(immutable) 로그
- Partition이 많을수록 병렬 처리 성능 향상

```
Topic: payment.completed (3개의 파티션)

Partition 0: [msg0] [msg3] [msg6] [msg9]  ...
Partition 1: [msg1] [msg4] [msg7] [msg10] ...
Partition 2: [msg2] [msg5] [msg8] [msg11] ...
             └─────────────────────────────┘
                 각 파티션 내에서만 순서 보장
```

#### **5) Broker (브로커)**
- Kafka 서버의 단위 (하나의 Kafka 프로세스)
- 여러 Broker가 모여 Kafka Cluster를 구성
- 각 Broker는 여러 Topic의 Partition을 분산 저장

#### **6) Offset (오프셋)**
- Partition 내에서 각 메시지의 고유한 순번
- Consumer는 자신이 읽은 마지막 Offset을 기록하여 이어서 읽기 가능
- 장애 복구 시에도 중복 없이 처리 가능 (최소 1회 전달 보장)

```
Partition 0
┌───────┬───────┬───────┬───────┬───────┐
│ Msg 0 │ Msg 1 │ Msg 2 │ Msg 3 │ Msg 4 │
└───────┴───────┴───────┴───────┴───────┘
  offset   offset  offset  offset  offset
    0        1       2       3       4
                     ▲
                Consumer가 여기까지 읽음
                (다음은 offset 3부터 읽음)
```

#### **7) Consumer Group (컨슈머 그룹)**
- 여러 Consumer가 협력하여 하나의 Topic을 소비
- 같은 Group 내에서는 하나의 Partition을 하나의 Consumer만 담당
- 다른 Group은 동일한 메시지를 독립적으로 읽을 수 있음

```
Topic: payment.completed (3개의 파티션)

Consumer Group A (랭킹 서비스)
├─ Consumer A1 → Partition 0
├─ Consumer A2 → Partition 1
└─ Consumer A3 → Partition 2

Consumer Group B (데이터 플랫폼 서비스)
├─ Consumer B1 → Partition 0, 1
└─ Consumer B2 → Partition 2

→ Group A와 Group B는 동일한 메시지를 각자 처리
→ 각 Group 내에서는 파티션별로 분산 처리
```

---

## 3. Kafka의 핵심 기능

### 3-1. Publish/Subscribe 메시징

전통적인 메시지 큐와 달리, Kafka는 **한 번 발행한 메시지를 여러 구독자가 독립적으로 읽을 수 있습니다.**

```
[전통적 메시지 큐 - RabbitMQ]
Producer → Queue → Consumer A (메시지 소비 후 삭제)
                   Consumer B (이미 삭제되어 읽을 수 없음)

[Kafka]
Producer → Topic → Consumer Group A (offset 관리)
                 → Consumer Group B (독립적인 offset 관리)
                 → Consumer Group C (나중에 추가되어도 처음부터 읽기 가능)
```

### 3-2. 메시지 영속성 (Durability)

Kafka는 메시지를 **디스크에 저장**하므로:
- Consumer가 일시적으로 죽어도 메시지 유실 없음
- 과거 데이터를 재처리(replay) 가능
- 기본 보관 기간: 7일 (설정 가능)

```
[시나리오]
09:00 - 결제 완료 이벤트 발행 → Kafka에 저장
09:05 - 랭킹 서비스가 읽어서 처리 ✓
10:00 - 데이터 플랫폼 서비스 장애로 읽지 못함 ✗
12:00 - 데이터 플랫폼 서비스 복구 → Kafka에서 09:00 메시지부터 읽어서 처리 ✓

→ 메시지가 디스크에 남아있어서 재처리 가능!
```

### 3-3. 높은 처리량 (High Throughput)

Kafka는 초당 **수백만 건의 메시지**를 처리할 수 있습니다.

**핵심 기술:**
1. **배치 처리**: 메시지를 모아서 한 번에 전송/저장
2. **Zero-Copy**: OS 커널 레벨에서 데이터를 복사하지 않고 전송
3. **순차 I/O**: 디스크의 특정 위치에 순차적으로 쓰기 (랜덤 쓰기보다 훨씬 빠름)
4. **Partition 병렬 처리**: 여러 Partition에 분산 저장하여 병렬 읽기/쓰기

### 3-4. 확장성 (Scalability)

**수평 확장이 쉽습니다:**

```
[트래픽 증가 전]
Broker 1: Partition 0, 1
Broker 2: Partition 2, 3

[트래픽 증가 후 - Broker 추가]
Broker 1: Partition 0, 1
Broker 2: Partition 2, 3
Broker 3: Partition 4, 5  ← 새로 추가
Broker 4: Partition 6, 7  ← 새로 추가

→ 애플리케이션 코드 수정 없이 확장 가능
```

### 3-5. 내결함성 (Fault Tolerance)

**Replication (복제)**를 통해 데이터 유실을 방지합니다.

```
Topic: payment.completed, Replication Factor = 3

Broker 1: Partition 0 (Leader)
Broker 2: Partition 0 (Follower)
Broker 3: Partition 0 (Follower)

→ Broker 1이 죽으면 Broker 2 또는 3이 자동으로 Leader가 됨
→ 데이터 유실 없이 서비스 지속
```

---

## 4. Kafka의 장단점

### 4-1. Kafka의 장점

| 장점 | 설명 | 우리 서비스에 미치는 영향 |
|------|------|--------------------------|
| **높은 처리량** | 초당 수백만 건 처리 가능 | 대규모 콘서트 예매 오픈 시 폭증하는 트래픽 처리 |
| **확장성** | Broker, Partition 추가로 수평 확장 | 트래픽 증가에 따라 유연하게 확장 가능 |
| **내결함성** | Replication으로 데이터 유실 방지 | 결제 완료 이벤트 등 중요한 메시지 보호 |
| **메시지 영속성** | 디스크 저장, 설정 기간 동안 보관 | 장애 복구 시 과거 이벤트 재처리 가능 |
| **순서 보장** | Partition 내에서 순서 보장 | 같은 사용자의 이벤트 순서대로 처리 가능 |
| **느슨한 결합** | Producer와 Consumer가 서로를 몰라도 됨 | 새로운 서비스(예: 알림 서비스) 추가가 쉬움 |
| **다중 구독자** | 하나의 이벤트를 여러 서비스가 독립적으로 처리 | 랭킹, 데이터 플랫폼, 알림 등 각자 처리 |

### 4-2. Kafka의 단점

| 단점 | 설명 | 대응 방안 |
|------|------|----------|
| **운영 복잡도** | Broker, Zookeeper(또는 KRaft) 클러스터 관리 필요 | 관리형 Kafka 서비스 사용 (AWS MSK, Confluent Cloud 등) |
| **학습 곡선** | Producer, Consumer, Partition, Offset 등 개념 이해 필요 | 충분한 학습 기간과 PoC(Proof of Concept) 진행 |
| **즉시 처리 불가** | 이벤트 기반이므로 약간의 지연 발생 (보통 수 ms~수백 ms) | 실시간 응답이 필요한 곳은 동기 API 사용, 부가 작업만 Kafka로 처리 |
| **메시지 중복 가능** | at-least-once 전달 보장 (정확히 1회는 어려움) | Consumer에서 멱등성(idempotency) 구현 필요 |
| **Partition 내에서만 순서 보장** | 다른 Partition의 메시지 간에는 순서 보장 안 됨 | 순서가 중요한 메시지는 같은 Partition으로 전송 (예: userId를 key로 사용) |
| **인프라 비용** | Broker 서버, 스토리지 비용 발생 | 트래픽과 보관 기간을 적절히 설정하여 비용 최적화 |

### 4-3. Kafka vs 다른 메시지 브로커

| 기준 | Kafka | RabbitMQ | Redis Pub/Sub |
|------|-------|----------|---------------|
| **처리량** | 매우 높음 (수백만/초) | 중간 (수만~수십만/초) | 높음 (수십만/초) |
| **메시지 영속성** | ✅ 디스크 저장 | ✅ 옵션으로 가능 | ❌ 메모리만, 재시작 시 유실 |
| **메시지 순서** | ✅ Partition 내 보장 | ✅ Queue 내 보장 | ❌ 보장 안 됨 |
| **다중 구독자** | ✅ 여러 Consumer Group | ⚠️ 제한적 (Fanout Exchange) | ✅ 여러 구독자 가능 |
| **메시지 재처리** | ✅ Offset 이동으로 가능 | ❌ 불가능 (소비 후 삭제) | ❌ 불가능 |
| **운영 복잡도** | 높음 | 중간 | 낮음 |
| **적합한 용도** | 대용량 이벤트 스트리밍, 로그 집계, MSA 이벤트 버스 | 작업 큐, 요청-응답 패턴 | 간단한 실시간 알림 |

**우리 서비스 선택 기준:**
- ✅ 높은 처리량 필요 (대규모 예매)
- ✅ 메시지 재처리 필요 (장애 복구)
- ✅ 여러 서비스가 동일 이벤트 구독
- ✅ MSA 전환을 고려

→ **Kafka가 가장 적합**

---

## 5. 이벤트 아이디어를 시스템 전체로 확장하기

### 5-1. 현재 상태: In-Process 이벤트

현재 콘서트 예약 서비스는 `@nestjs/event-emitter`를 사용한 **in-process 이벤트** 방식입니다.

```typescript
// PaymentService.ts (이벤트 발행)
this.eventEmitter.emit(
  PaymentCompletedEvent.EVENT_NAME,
  new PaymentCompletedEvent(paymentId, userId, reservationId, seatId, amount),
);

// PaymentEventHandler.ts (이벤트 구독)
@OnEvent(PaymentCompletedEvent.EVENT_NAME)
async handleRankingUpdate(event: PaymentCompletedEvent) {
  // 랭킹 갱신 처리
}

@OnEvent(PaymentCompletedEvent.EVENT_NAME)
async handleDataPlatformNotification(event: PaymentCompletedEvent) {
  // 데이터 플랫폼 전송
}
```

**현재 구조:**
```
┌────────────────────────────────────────────────────┐
│            NestJS Application (모놀리식)             │
│                                                     │
│  PaymentService                                     │
│       │                                             │
│       ├─ EventEmitter.emit()                        │
│       │         │                                   │
│       │         ├──→ PaymentEventHandler            │
│       │         │         ├─ RankingService         │
│       │         │         └─ DataPlatformService    │
│       │         │                                   │
│  (같은 프로세스, 같은 메모리)                          │
└────────────────────────────────────────────────────┘
```

**문제점:**
- 모든 서비스가 하나의 프로세스에 존재 → 독립 배포 불가
- 이벤트가 메모리에만 존재 → 애플리케이션 재시작 시 유실
- 확장성 제한 → 하나의 서버 성능에 의존

### 5-2. Kafka를 활용한 시스템 전체 이벤트 아키텍처

Kafka를 도입하면 **이벤트를 시스템 전체의 통신 수단**으로 확장할 수 있습니다.

```
┌──────────────────┐                    ┌──────────────────┐
│ Payment Service  │                    │ Ranking Service  │
│                  │                    │                  │
│ processPayment() │                    │ @Consumer        │
│      │           │                    │ updateRanking()  │
│      ├─ save()   │                    │                  │
│      │           │                    └──────────────────┘
│      ├─ emit()   │                             ▲
│      │           │                             │
└──────┼───────────┘                             │
       │                                         │
       ▼                                         │
  ┌─────────────────────────────────────────────┼────┐
  │               Kafka Cluster                  │    │
  │                                              │    │
  │  Topic: payment.completed                    │    │
  │  ├─ Partition 0: [msg1] [msg4] [msg7] ...   │    │
  │  ├─ Partition 1: [msg2] [msg5] [msg8] ...   │    │
  │  └─ Partition 2: [msg3] [msg6] [msg9] ...   │    │
  │                                              │    │
  └──────────────────────────────────────────────┼────┘
       │                                         │
       │                                         │
       ▼                                         │
┌──────────────────┐                             │
│ DataPlatform     │                             │
│ Service          │                             │
│                  │                             │
│ @Consumer        │─────────────────────────────┘
│ sendReservation()│
└──────────────────┘
```

**Kafka 도입 후 구조:**

```
[Before] In-Process Event
PaymentService → EventEmitter → 같은 프로세스의 핸들러 (메모리)

[After] Kafka Event
PaymentService → Kafka Producer → Kafka Broker (디스크)
                                        ↓
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                  Ranking Service  DataPlatform   Notification
                   (독립 배포)      (독립 배포)      (독립 배포)
```

### 5-3. 이벤트 중심 아키텍처의 핵심 개념

#### **1) Event-Driven Architecture (EDA)**

시스템의 상태 변화를 **이벤트**로 표현하고, 이벤트를 중심으로 서비스를 연결합니다.

```
[전통적 방식 - Request-Response]
사용자 → 결제 API 호출 → 결제 처리
                      └→ 랭킹 서비스 API 호출 (동기, 블로킹)
                      └→ 데이터 플랫폼 API 호출 (동기, 블로킹)
                      └→ 알림 서비스 API 호출 (동기, 블로킹)
        ← 모든 처리 완료 후 응답 (느림)

[이벤트 기반 방식]
사용자 → 결제 API 호출 → 결제 처리
                      └→ Kafka에 이벤트 발행 (비동기)
        ← 즉시 응답 반환 (빠름)

                         Kafka
                          ├→ 랭킹 서비스 (독립 처리)
                          ├→ 데이터 플랫폼 (독립 처리)
                          └→ 알림 서비스 (독립 처리)
```

**장점:**
- 응답 속도 향상 (비동기 처리)
- 서비스 간 결합도 감소
- 새로운 기능 추가가 쉬움 (Consumer만 추가)

#### **2) Event Sourcing**

시스템의 모든 상태 변화를 **이벤트로 저장**하는 패턴입니다.

```
[전통적 방식 - 현재 상태만 저장]
users 테이블
┌────────┬─────────┬─────────┐
│ userId │  name   │ points  │
├────────┼─────────┼─────────┤
│   1    │ 홍길동  │  5000   │  ← 현재 포인트만 알 수 있음
└────────┴─────────┴─────────┘

[Event Sourcing - 모든 변화를 이벤트로 저장]
point_events (Kafka Topic)
┌──────────────────────┬────────┬────────┬────────┐
│      eventType       │ userId │ amount │  time  │
├──────────────────────┼────────┼────────┼────────┤
│ PointCharged         │   1    │ +10000 │ 09:00  │
│ PointUsed (payment1) │   1    │  -3000 │ 09:30  │
│ PointUsed (payment2) │   1    │  -2000 │ 10:00  │
└──────────────────────┴────────┴────────┴────────┘
                                          ↓
                              현재 포인트 = 5000
                              (10000 - 3000 - 2000)

→ 과거 모든 변화를 추적 가능
→ 특정 시점의 상태를 재구성 가능
→ 감사(audit) 및 디버깅에 유리
```

#### **3) CQRS (Command Query Responsibility Segregation)**

명령(Command, 쓰기)과 조회(Query, 읽기)를 분리하는 패턴입니다.

```
[CQRS + Kafka]

명령 (Write)                          조회 (Read)
   ↓                                     ↑
┌─────────────┐                    ┌──────────┐
│ Command API │                    │ Query API│
│ (결제 처리)  │                    │ (결제 조회)│
└──────┬──────┘                    └────▲─────┘
       │                                 │
       ├─ MySQL (Write DB)               │
       │  payment 테이블                  │
       │                                 │
       └─ Kafka Event 발행 ──────────────┤
                                         │
                                    ┌────┴─────┐
                                    │  Redis   │
                                    │ (Read DB)│
                                    │  캐시     │
                                    └──────────┘

→ Write는 정합성 중요 (MySQL)
→ Read는 속도 중요 (Redis 캐시)
→ Kafka로 양쪽 동기화
```

---

## 6. 콘서트 예약 서비스에 Kafka 적용하기

### 6-1. 현재 이벤트 구조 분석

현재 `PaymentCompletedEvent`가 발행되면 두 가지 작업이 수행됩니다:

```typescript
// 현재 구조
@OnEvent('payment.completed')
async handleRankingUpdate(event: PaymentCompletedEvent) {
  const scheduleId = await this.concertRepository.findScheduleIdBySeatId(event.seatId);
  if (scheduleId) {
    await this.rankingService.onReservationConfirmed(scheduleId);
  }
}

@OnEvent('payment.completed')
async handleDataPlatformNotification(event: PaymentCompletedEvent) {
  await this.dataPlatformService.sendReservationInfo(event);
}
```

**문제점:**
- 두 핸들러가 같은 프로세스에서 순차 실행 → 하나가 느리면 전체가 느려짐
- 에러 처리가 복잡 (하나 실패해도 다른 것은 성공해야 함)
- 독립적으로 확장 불가능 (서버를 늘려도 같이 늘어남)

### 6-2. Kafka 적용 설계

#### **단계 1: Topic 설계**

```
Topic 이름: payment.completed
Partition 수: 3개 (트래픽에 따라 조정)
Replication Factor: 3 (고가용성)
Retention: 7일 (재처리를 위한 보관 기간)
Key: userId (같은 사용자의 이벤트는 순서 보장)
```

**메시지 스키마:**
```json
{
  "eventId": "uuid-v4",
  "eventType": "payment.completed",
  "eventTime": "2025-02-28T10:30:00Z",
  "payload": {
    "paymentId": "pay_12345",
    "userId": "user_67890",
    "reservationId": "res_11111",
    "seatId": "seat_22222",
    "amount": 50000,
    "concertScheduleId": "sch_33333"
  }
}
```

#### **단계 2: Producer 구현 (Payment Service)**

```typescript
// payment.service.ts
import { Injectable } from '@nestjs/common';
import { KafkaProducer } from './kafka/kafka.producer';

@Injectable()
export class PaymentService {
  constructor(
    private readonly kafkaProducer: KafkaProducer,
    // ...
  ) {}

  async processPayment(userId: string, reservationId: string, amount: number) {
    return this.dataSource.transaction(async (manager) => {
      // 1. 결제 처리
      const payment = await manager.save(Payment, { /* ... */ });

      // 2. Outbox 패턴 적용 (이벤트를 DB에 함께 저장)
      await manager.save(OutboxEvent, {
        eventType: 'payment.completed',
        payload: {
          paymentId: payment.paymentId,
          userId,
          reservationId,
          seatId: payment.seatId,
          amount,
        },
        status: 'PENDING',
      });

      return payment;
    });
    // 트랜잭션 커밋 성공 후 이벤트 발행은 별도 Poller가 처리
  }
}
```

```typescript
// outbox.poller.ts (별도 스케줄러)
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KafkaProducer } from './kafka/kafka.producer';

@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);

  constructor(
    private readonly kafkaProducer: KafkaProducer,
    private readonly outboxRepository: OutboxEventRepository,
  ) {}

  @Cron('*/5 * * * * *') // 5초마다 실행
  async pollAndPublish() {
    const pendingEvents = await this.outboxRepository.find({
      where: { status: 'PENDING' },
      take: 100,
    });

    for (const event of pendingEvents) {
      try {
        // Kafka로 발행
        await this.kafkaProducer.send({
          topic: event.eventType,
          messages: [{
            key: event.payload.userId, // 같은 사용자는 같은 파티션으로
            value: JSON.stringify(event.payload),
          }],
        });

        // 발행 완료 표시
        await this.outboxRepository.update(event.id, { status: 'PUBLISHED' });
        this.logger.log(`Event ${event.id} published to Kafka`);
      } catch (error) {
        this.logger.error(`Failed to publish event ${event.id}`, error);
        // 재시도 로직 (exponential backoff 등)
      }
    }
  }
}
```

#### **단계 3: Consumer 구현 (Ranking Service)**

```typescript
// ranking.consumer.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import { RankingService } from './ranking.service';

@Injectable()
export class RankingConsumer implements OnModuleInit {
  private readonly logger = new Logger(RankingConsumer.name);
  private consumer: Consumer;

  constructor(private readonly rankingService: RankingService) {
    const kafka = new Kafka({
      clientId: 'ranking-service',
      brokers: ['kafka-broker-1:9092', 'kafka-broker-2:9092'],
    });

    this.consumer = kafka.consumer({
      groupId: 'ranking-service-group', // Consumer Group
    });
  }

  async onModuleInit() {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: 'payment.completed',
      fromBeginning: false, // 최신 메시지부터 읽기
    });

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const event = JSON.parse(message.value.toString());

        try {
          // 멱등성 체크 (중복 처리 방지)
          const alreadyProcessed = await this.checkIfProcessed(event.paymentId);
          if (alreadyProcessed) {
            this.logger.warn(`Event ${event.paymentId} already processed, skipping`);
            return;
          }

          // 랭킹 갱신 처리
          await this.rankingService.onReservationConfirmed(event.payload.concertScheduleId);

          // 처리 완료 기록 (멱등성 보장)
          await this.markAsProcessed(event.paymentId);

          this.logger.log(`Ranking updated for schedule ${event.payload.concertScheduleId}`);
        } catch (error) {
          this.logger.error(`Failed to process event ${event.paymentId}`, error);
          // 에러 처리 전략:
          // 1. 재시도 (일시적 오류)
          // 2. Dead Letter Queue로 전송 (영구적 오류)
          // 3. 알림 발송 (모니터링)
        }
      },
    });
  }

  private async checkIfProcessed(paymentId: string): Promise<boolean> {
    // Redis나 DB에서 처리 여부 확인
    return this.redis.exists(`processed:payment:${paymentId}`);
  }

  private async markAsProcessed(paymentId: string): Promise<void> {
    // 처리 완료 표시 (TTL 설정으로 자동 삭제)
    await this.redis.setex(`processed:payment:${paymentId}`, 86400, '1'); // 24시간
  }
}
```

#### **단계 4: Consumer 구현 (DataPlatform Service)**

```typescript
// data-platform.consumer.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import { DataPlatformService } from './data-platform.service';

@Injectable()
export class DataPlatformConsumer implements OnModuleInit {
  private readonly logger = new Logger(DataPlatformConsumer.name);
  private consumer: Consumer;

  constructor(private readonly dataPlatformService: DataPlatformService) {
    const kafka = new Kafka({
      clientId: 'data-platform-service',
      brokers: ['kafka-broker-1:9092', 'kafka-broker-2:9092'],
    });

    this.consumer = kafka.consumer({
      groupId: 'data-platform-service-group', // Ranking과 다른 그룹
    });
  }

  async onModuleInit() {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: 'payment.completed',
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const event = JSON.parse(message.value.toString());

        try {
          // 데이터 플랫폼으로 전송
          await this.dataPlatformService.sendReservationInfo(event.payload);

          this.logger.log(`Data sent to platform for payment ${event.payload.paymentId}`);
        } catch (error) {
          this.logger.error(`Failed to send data for payment ${event.payload.paymentId}`, error);
          // 재시도 로직
        }
      },
    });
  }
}
```

### 6-3. Kafka 적용 후 아키텍처

```
┌───────────────────────────────────────────────────────────┐
│                  Payment Service (독립 배포)               │
│                                                            │
│  POST /payments                                            │
│    ├─ BEGIN TRANSACTION                                    │
│    │    ├─ INSERT payment                                  │
│    │    └─ INSERT outbox_events (status='PENDING')         │
│    └─ COMMIT                                               │
│                                                            │
│  Outbox Poller (@Cron)                                     │
│    ├─ SELECT * FROM outbox_events WHERE status='PENDING'   │
│    ├─ Kafka.send(topic: 'payment.completed')              │
│    └─ UPDATE status='PUBLISHED'                            │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
              ┌────────────────────┐
              │   Kafka Cluster    │
              │                    │
              │ payment.completed  │
              │  ├─ Partition 0    │
              │  ├─ Partition 1    │
              │  └─ Partition 2    │
              └──┬──────────────┬──┘
                 │              │
     ┌───────────▼──┐      ┌───▼────────────┐
     │   Ranking    │      │ DataPlatform   │
     │   Service    │      │    Service     │
     │              │      │                │
     │ Consumer     │      │  Consumer      │
     │ Group: R     │      │  Group: DP     │
     │              │      │                │
     │ Redis 갱신   │      │  API 전송      │
     └──────────────┘      └────────────────┘

→ 각 서비스 독립 배포 가능
→ 하나의 서비스 장애가 다른 서비스에 영향 없음
→ 새로운 Consumer 추가 쉬움 (예: 알림 서비스)
```

### 6-4. 추가 이벤트 설계 예시

콘서트 예약 서비스에서 발생할 수 있는 다른 이벤트들:

```
Topic: reservation.created
→ Consumer: 예약 만료 스케줄러, 알림 서비스

Topic: reservation.expired
→ Consumer: 좌석 재고 복구 서비스, 알림 서비스

Topic: concert.schedule.created
→ Consumer: 캐시 갱신 서비스, 검색 인덱스 서비스

Topic: user.registered
→ Consumer: 환영 이메일 서비스, 쿠폰 발급 서비스

Topic: queue.token.issued
→ Consumer: 대기 상태 알림 서비스
```

**이벤트 네이밍 규칙:**
```
{domain}.{entity}.{action}

예:
payment.completed       (결제 완료)
reservation.created     (예약 생성)
concert.schedule.updated (스케줄 수정)
user.registered         (사용자 등록)
```

---

## 7. 정리

### 7-1. Kafka 핵심 요약

| 항목 | 설명 |
|------|------|
| **Kafka는** | 분산 이벤트 스트리밍 플랫폼 |
| **주요 구성 요소** | Producer, Consumer, Topic, Partition, Broker, Offset |
| **핵심 기능** | Pub/Sub 메시징, 메시지 영속성, 높은 처리량, 확장성, 내결함성 |
| **장점** | 높은 처리량, 확장성, 내결함성, 메시지 재처리, 다중 구독자 |
| **단점** | 운영 복잡도, 학습 곡선, 즉시 처리 불가, 메시지 중복 가능 |
| **적합한 용도** | MSA 이벤트 버스, 로그 집계, 실시간 데이터 파이프라인, 이벤트 소싱 |

### 7-2. 우리 서비스에 Kafka를 사용하는 이유

1. **MSA 전환 준비**: 서비스 간 느슨한 결합을 위한 이벤트 버스
2. **높은 처리량**: 대규모 콘서트 예매 오픈 시 폭증하는 트래픽 처리
3. **메시지 유실 방지**: 결제 완료 등 중요한 이벤트를 디스크에 영속화
4. **독립적 확장**: 랭킹, 데이터 플랫폼 등 각 서비스를 독립적으로 확장
5. **새로운 기능 추가 용이**: 이벤트를 구독하는 새 Consumer만 추가하면 됨

### 7-3. 적용 로드맵

```
[Step 1] Kafka 클러스터 구축 ✅ 예정
  └─ Docker Compose로 로컬 환경 구축
  └─ Broker 3대, Zookeeper 3대 (또는 KRaft 모드)

[Step 2] Outbox 패턴 구현 ✅ 예정
  └─ outbox_events 테이블 생성
  └─ OutboxPoller 스케줄러 구현

[Step 3] Producer 구현 ✅ 예정
  └─ PaymentService에 Kafka Producer 통합
  └─ payment.completed 이벤트 발행

[Step 4] Consumer 구현 ✅ 예정
  └─ RankingConsumer 구현
  └─ DataPlatformConsumer 구현
  └─ 멱등성 보장 로직 추가

[Step 5] 모니터링 구축 ✅ 예정
  └─ Kafka UI 설치 (akhq, kafka-ui 등)
  └─ Consumer Lag 모니터링
  └─ Dead Letter Queue 구축

[Step 6] 성능 테스트 ✅ 예정
  └─ 부하 테스트 (k6, JMeter)
  └─ 병목 구간 식별 및 최적화

[Step 7] 추가 이벤트 확장 ✅ 예정
  └─ reservation.created
  └─ concert.schedule.created
  └─ user.registered
```

### 7-4. 참고 자료

- [Apache Kafka 공식 문서](https://kafka.apache.org/documentation/)
- [Confluent Kafka 튜토리얼](https://developer.confluent.io/)
- [NestJS Kafka 통합](https://docs.nestjs.com/microservices/kafka)
- [Outbox 패턴 설명](https://microservices.io/patterns/data/transactional-outbox.html)
- [Saga 패턴 설명](https://microservices.io/patterns/data/saga.html)

---

**작성일**: 2026-02-28
**작성자**: 콘서트 예약 서비스 개발팀
**버전**: 1.0
