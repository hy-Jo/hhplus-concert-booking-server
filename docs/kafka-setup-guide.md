# Kafka 로컬 설치 및 기본 기능 테스트 가이드

## 목차
1. [사전 준비](#1-사전-준비)
2. [Kafka 클러스터 실행](#2-kafka-클러스터-실행)
3. [Kafka 기본 기능 테스트](#3-kafka-기본-기능-테스트)
4. [Kafka UI 설치 (선택)](#4-kafka-ui-설치-선택)
5. [문제 해결](#5-문제-해결)

---

## 1. 사전 준비

### 1-1. Docker 설치 확인

Kafka를 Docker Compose로 실행하기 위해 Docker가 설치되어 있어야 합니다.

```bash
# Docker 버전 확인
docker --version
# 예상 출력: Docker version 24.0.0, build ...

# Docker Compose 버전 확인
docker compose version
# 예상 출력: Docker Compose version v2.20.0
```

**Docker가 설치되어 있지 않다면:**
- Windows: [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) 설치
- Mac: [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) 설치
- Linux: [Docker Engine](https://docs.docker.com/engine/install/) 설치

### 1-2. 시스템 리소스 확인

Kafka 클러스터(Zookeeper 1개 + Broker 3개)를 실행하려면 충분한 리소스가 필요합니다.

**권장 사양:**
- RAM: 최소 4GB, 권장 8GB 이상
- CPU: 2 코어 이상
- 디스크: 10GB 이상 여유 공간

**Docker Desktop 리소스 설정 (Windows/Mac):**
1. Docker Desktop 실행
2. Settings → Resources
3. Memory: 4GB 이상 할당
4. CPUs: 2개 이상 할당
5. Apply & Restart

---

## 2. Kafka 클러스터 실행

### 2-1. Docker Compose 실행

프로젝트 루트 디렉토리에서 다음 명령어를 실행합니다.

```bash
# Kafka 클러스터 백그라운드 실행
docker compose -f docker-compose.kafka.yaml up -d

# 예상 출력:
# [+] Running 4/4
#  ✔ Container zookeeper  Started
#  ✔ Container broker1    Started
#  ✔ Container broker2    Started
#  ✔ Container broker3    Started
```

### 2-2. 클러스터 상태 확인

```bash
# 실행 중인 컨테이너 확인
docker compose -f docker-compose.kafka.yaml ps

# 예상 출력:
# NAME        IMAGE                              STATUS
# broker1     confluentinc/cp-kafka:7.6.0        Up
# broker2     confluentinc/cp-kafka:7.6.0        Up
# broker3     confluentinc/cp-kafka:7.6.0        Up
# zookeeper   confluentinc/cp-zookeeper:7.6.0    Up
```

### 2-3. 로그 확인

```bash
# 모든 컨테이너 로그 확인
docker compose -f docker-compose.kafka.yaml logs -f

# 특정 브로커 로그만 확인
docker compose -f docker-compose.kafka.yaml logs -f broker1

# Ctrl+C로 로그 확인 종료
```

---

## 3. Kafka 기본 기능 테스트

### 3-1. Topic 생성

Kafka에 메시지를 저장하려면 먼저 Topic을 생성해야 합니다.

```bash
# broker1 컨테이너에 접속
docker exec -it broker1 bash

# Topic 생성 (컨테이너 내부에서 실행)
kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic test-topic \
  --partitions 3 \
  --replication-factor 3

# 예상 출력:
# Created topic test-topic.
```

**옵션 설명:**
- `--bootstrap-server localhost:9092`: Kafka 브로커 주소
- `--topic test-topic`: 생성할 Topic 이름
- `--partitions 3`: Partition 개수 (병렬 처리 단위)
- `--replication-factor 3`: 복제본 개수 (데이터 안정성)

### 3-2. Topic 목록 조회

```bash
# Topic 목록 확인 (컨테이너 내부에서 실행)
kafka-topics --list --bootstrap-server localhost:9092

# 예상 출력:
# test-topic
```

### 3-3. Topic 상세 정보 확인

```bash
# Topic 상세 정보 확인 (컨테이너 내부에서 실행)
kafka-topics --describe \
  --bootstrap-server localhost:9092 \
  --topic test-topic

# 예상 출력:
# Topic: test-topic       PartitionCount: 3       ReplicationFactor: 3    Configs:
#         Topic: test-topic       Partition: 0    Leader: 1       Replicas: 1,2,3 Isr: 1,2,3
#         Topic: test-topic       Partition: 1    Leader: 2       Replicas: 2,3,1 Isr: 2,3,1
#         Topic: test-topic       Partition: 2    Leader: 3       Replicas: 3,1,2 Isr: 3,1,2
```

**출력 설명:**
- `Leader`: 해당 Partition의 읽기/쓰기를 담당하는 Broker
- `Replicas`: 복제본이 저장된 Broker 목록
- `Isr` (In-Sync Replicas): Leader와 동기화된 Broker 목록

### 3-4. Producer 테스트 (메시지 발행)

```bash
# Producer 실행 (컨테이너 내부에서 실행)
kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic test-topic

# 프롬프트가 나타나면 메시지 입력 (엔터로 전송)
> Hello Kafka!
> This is a test message
> Payment completed: user_123, amount: 50000
> ^C (Ctrl+C로 종료)
```

### 3-5. Consumer 테스트 (메시지 구독)

**새 터미널을 열어서** 다음 명령어를 실행합니다.

```bash
# broker1 컨테이너에 접속 (새 터미널)
docker exec -it broker1 bash

# Consumer 실행 (처음부터 읽기)
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic test-topic \
  --from-beginning

# 예상 출력:
# Hello Kafka!
# This is a test message
# Payment completed: user_123, amount: 50000
```

**Consumer를 실행한 상태에서 Producer로 새 메시지를 보내면 실시간으로 출력됩니다!**

### 3-6. Consumer Group 테스트

Consumer Group을 사용하면 여러 Consumer가 협력하여 메시지를 분산 처리할 수 있습니다.

**터미널 1 - Consumer 1:**
```bash
docker exec -it broker1 bash

kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic test-topic \
  --group test-consumer-group \
  --from-beginning
```

**터미널 2 - Consumer 2:**
```bash
docker exec -it broker2 bash

kafka-console-consumer \
  --bootstrap-server localhost:9093 \
  --topic test-topic \
  --group test-consumer-group \
  --from-beginning
```

**터미널 3 - Producer:**
```bash
docker exec -it broker3 bash

kafka-console-producer \
  --bootstrap-server localhost:9094 \
  --topic test-topic

# 메시지 10개 전송
> message-1
> message-2
> message-3
> ...
> message-10
```

**결과 확인:**
- Consumer 1과 Consumer 2가 메시지를 분산하여 받습니다.
- 같은 Consumer Group 내에서는 하나의 메시지를 하나의 Consumer만 처리합니다.

### 3-7. Consumer Group 상태 확인

```bash
# Consumer Group 목록 조회
kafka-consumer-groups --list \
  --bootstrap-server localhost:9092

# 예상 출력:
# test-consumer-group

# Consumer Group 상세 정보 확인
kafka-consumer-groups --describe \
  --bootstrap-server localhost:9092 \
  --group test-consumer-group

# 예상 출력:
# GROUP               TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# test-consumer-group test-topic      0          5               5               0
# test-consumer-group test-topic      1          3               3               0
# test-consumer-group test-topic      2          2               2               0
```

**출력 설명:**
- `CURRENT-OFFSET`: Consumer가 읽은 마지막 Offset
- `LOG-END-OFFSET`: Partition의 마지막 Offset
- `LAG`: 처리되지 않은 메시지 개수 (LOG-END-OFFSET - CURRENT-OFFSET)

### 3-8. 콘서트 예약 서비스 이벤트 테스트

실제 서비스에서 사용할 `payment.completed` Topic을 생성하고 테스트해봅니다.

```bash
# payment.completed Topic 생성
kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic payment.completed \
  --partitions 3 \
  --replication-factor 3

# Producer로 결제 완료 이벤트 발행
kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic payment.completed

# JSON 형태의 메시지 전송
> {"eventId":"evt_001","eventType":"payment.completed","eventTime":"2026-02-28T10:30:00Z","payload":{"paymentId":"pay_123","userId":"user_456","reservationId":"res_789","seatId":"seat_111","amount":50000}}
```

**새 터미널에서 Consumer 실행:**
```bash
# Ranking Service Consumer 시뮬레이션
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic payment.completed \
  --group ranking-service-group \
  --from-beginning

# 예상 출력:
# {"eventId":"evt_001","eventType":"payment.completed",...}
```

---

## 4. Kafka UI 설치 (선택)

CLI 대신 웹 UI로 Kafka를 관리하고 싶다면 Kafka UI를 설치할 수 있습니다.

### 4-1. Kafka UI 추가 (docker-compose.kafka.yaml 수정)

프로젝트 루트에 `docker-compose.kafka-with-ui.yaml` 파일을 생성합니다.

```yaml
version: '3.8'

services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    hostname: zookeeper
    container_name: zookeeper
    ports:
      - "2181:2181"
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000

  broker1:
    image: confluentinc/cp-kafka:7.6.0
    hostname: broker1
    container_name: broker1
    ports:
      - "9092:9092"
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: 'zookeeper:2181'
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://broker1:29092,PLAINTEXT_HOST://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_LOG_RETENTION_MS: 604800000
      KAFKA_LOG_RETENTION_BYTES: 1073741824

  broker2:
    image: confluentinc/cp-kafka:7.6.0
    hostname: broker2
    container_name: broker2
    ports:
      - "9093:9093"
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 2
      KAFKA_ZOOKEEPER_CONNECT: 'zookeeper:2181'
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://broker2:29093,PLAINTEXT_HOST://localhost:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_LOG_RETENTION_MS: 604800000
      KAFKA_LOG_RETENTION_BYTES: 1073741824

  broker3:
    image: confluentinc/cp-kafka:7.6.0
    hostname: broker3
    container_name: broker3
    ports:
      - "9094:9094"
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 3
      KAFKA_ZOOKEEPER_CONNECT: 'zookeeper:2181'
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://broker3:29094,PLAINTEXT_HOST://localhost:9094
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_LOG_RETENTION_MS: 604800000
      KAFKA_LOG_RETENTION_BYTES: 1073741824

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: kafka-ui
    ports:
      - "8080:8080"
    depends_on:
      - broker1
      - broker2
      - broker3
    environment:
      KAFKA_CLUSTERS_0_NAME: local-cluster
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: broker1:29092,broker2:29093,broker3:29094
      KAFKA_CLUSTERS_0_ZOOKEEPER: zookeeper:2181
```

### 4-2. UI 포함 클러스터 실행

```bash
# 기존 클러스터 종료 (실행 중인 경우)
docker compose -f docker-compose.kafka.yaml down

# UI 포함 클러스터 실행
docker compose -f docker-compose.kafka-with-ui.yaml up -d

# 브라우저에서 접속
# http://localhost:8080
```

### 4-3. Kafka UI 사용법

브라우저에서 `http://localhost:8080`에 접속하면 다음 기능을 사용할 수 있습니다:

- **Brokers**: 브로커 상태 확인
- **Topics**: Topic 목록, 생성, 삭제, 메시지 조회
- **Consumers**: Consumer Group 상태, Lag 모니터링
- **Messages**: Topic별 메시지 조회 및 전송

---

## 5. 문제 해결

### 5-1. 포트 충돌 오류

```
Error: Bind for 0.0.0.0:9092 failed: port is already allocated
```

**해결 방법:**
```bash
# 포트 사용 중인 프로세스 확인 (Windows)
netstat -ano | findstr :9092

# 포트 사용 중인 프로세스 확인 (Mac/Linux)
lsof -i :9092

# 해당 프로세스 종료 후 재실행
```

### 5-2. 메모리 부족 오류

```
Error: Container killed: OOMKilled
```

**해결 방법:**
1. Docker Desktop Settings → Resources → Memory를 6GB 이상 할당
2. 또는 Broker 개수를 1개로 줄이기

```yaml
# docker-compose.kafka.yaml에서 broker2, broker3 주석 처리
# KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1로 변경
```

### 5-3. Zookeeper 연결 실패

```
Error: Connection to zookeeper failed
```

**해결 방법:**
```bash
# Zookeeper 로그 확인
docker compose -f docker-compose.kafka.yaml logs zookeeper

# Zookeeper 컨테이너 재시작
docker compose -f docker-compose.kafka.yaml restart zookeeper

# 모든 컨테이너 재시작
docker compose -f docker-compose.kafka.yaml restart
```

### 5-4. 클러스터 완전 초기화

모든 데이터를 삭제하고 처음부터 다시 시작하려면:

```bash
# 컨테이너 중지 및 삭제
docker compose -f docker-compose.kafka.yaml down

# 볼륨까지 삭제 (모든 데이터 삭제)
docker compose -f docker-compose.kafka.yaml down -v

# 이미지 삭제 (선택)
docker rmi confluentinc/cp-kafka:7.6.0
docker rmi confluentinc/cp-zookeeper:7.6.0

# 다시 실행
docker compose -f docker-compose.kafka.yaml up -d
```

---

## 6. 클러스터 종료

### 6-1. 정상 종료

```bash
# 컨테이너 중지 (데이터는 유지)
docker compose -f docker-compose.kafka.yaml stop

# 컨테이너 재시작
docker compose -f docker-compose.kafka.yaml start
```

### 6-2. 완전 종료

```bash
# 컨테이너 중지 및 삭제 (데이터는 유지)
docker compose -f docker-compose.kafka.yaml down

# 컨테이너 및 볼륨 삭제 (모든 데이터 삭제)
docker compose -f docker-compose.kafka.yaml down -v
```

---

## 7. 다음 단계

Kafka 클러스터가 정상적으로 실행되었다면, 다음 단계로 진행할 수 있습니다:

1. **NestJS Kafka 통합**: `kafkajs` 라이브러리로 Producer/Consumer 구현
2. **Outbox 패턴 구현**: 트랜잭션과 이벤트 발행의 원자성 보장
3. **모니터링 구축**: Consumer Lag, 처리량, 에러율 모니터링
4. **성능 테스트**: 대규모 트래픽 상황에서의 처리 성능 검증

---

**작성일**: 2026-02-28
**작성자**: 콘서트 예약 서비스 개발팀
**버전**: 1.0
