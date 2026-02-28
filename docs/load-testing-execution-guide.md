# 부하 테스트 실행 가이드

## 목차

1. [사전 준비](#1-사전-준비)
2. [테스트 환경 구성](#2-테스트-환경-구성)
3. [테스트 실행](#3-테스트-실행)
4. [리소스별 성능 비교](#4-리소스별-성능-비교)
5. [결과 분석](#5-결과-분석)
6. [문제 해결](#6-문제-해결)

---

## 1. 사전 준비

### 1-1. 필요한 도구 설치

#### k6 설치

**Windows (Chocolatey)**:
```bash
choco install k6
```

**macOS (Homebrew)**:
```bash
brew install k6
```

**Linux**:
```bash
# Ubuntu/Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**설치 확인**:
```bash
k6 version
# k6 v0.48.0 (commit/..., go1.21.3, windows/amd64)
```

#### Docker 및 Docker Compose 확인

```bash
docker --version
# Docker version 24.0.7

docker compose version
# Docker Compose version v2.23.0
```

---

### 1-2. 테스트 데이터 준비

부하 테스트 전에 DB에 테스트 데이터를 삽입해야 합니다.

**테스트 데이터 SQL 스크립트 생성**:

```sql
-- scripts/load-test-data.sql

-- 테스트용 콘서트 생성
INSERT INTO concert (concertId, title, description, artistName, createdAt)
VALUES
  ('concert_test_1', '테스트 콘서트 1', 'Load Test Concert 1', 'Test Artist', NOW()),
  ('concert_test_2', '테스트 콘서트 2', 'Load Test Concert 2', 'Test Artist', NOW()),
  ('concert_test_3', '테스트 콘서트 3', 'Load Test Concert 3', 'Test Artist', NOW());

-- 테스트용 콘서트 일정 생성
INSERT INTO concert_schedule (scheduleId, concertId, concertDate, venue, createdAt)
VALUES
  ('schedule_test_1', 'concert_test_1', '2026-03-15 19:00:00', 'Test Venue 1', NOW()),
  ('schedule_test_2', 'concert_test_1', '2026-03-16 19:00:00', 'Test Venue 1', NOW()),
  ('schedule_test_3', 'concert_test_2', '2026-03-20 19:00:00', 'Test Venue 2', NOW()),
  ('schedule_test_4', 'concert_test_2', '2026-03-21 19:00:00', 'Test Venue 2', NOW()),
  ('schedule_test_5', 'concert_test_3', '2026-03-25 19:00:00', 'Test Venue 3', NOW());

-- 테스트용 좌석 생성 (각 일정당 50개 좌석)
DELIMITER $$
CREATE PROCEDURE CreateTestSeats()
BEGIN
  DECLARE schedule_id VARCHAR(50);
  DECLARE seat_num INT;
  DECLARE seat_cursor CURSOR FOR
    SELECT scheduleId FROM concert_schedule WHERE scheduleId LIKE 'schedule_test_%';

  OPEN seat_cursor;

  schedule_loop: LOOP
    FETCH seat_cursor INTO schedule_id;
    IF NOT FOUND THEN
      LEAVE schedule_loop;
    END IF;

    SET seat_num = 1;
    WHILE seat_num <= 50 DO
      INSERT INTO seat (seatId, scheduleId, seatNo, price, status, createdAt)
      VALUES (
        CONCAT(schedule_id, '_seat_', seat_num),
        schedule_id,
        seat_num,
        50000,
        'AVAILABLE',
        NOW()
      );
      SET seat_num = seat_num + 1;
    END WHILE;
  END LOOP;

  CLOSE seat_cursor;
END$$
DELIMITER ;

CALL CreateTestSeats();
DROP PROCEDURE CreateTestSeats;

-- 테스트 데이터 확인
SELECT
  c.concertId,
  c.title,
  COUNT(DISTINCT cs.scheduleId) as schedule_count,
  COUNT(s.seatId) as seat_count
FROM concert c
LEFT JOIN concert_schedule cs ON c.concertId = cs.concertId
LEFT JOIN seat s ON cs.scheduleId = s.scheduleId
WHERE c.concertId LIKE 'concert_test_%'
GROUP BY c.concertId, c.title;
```

---

## 2. 테스트 환경 구성

### 2-1. Docker Compose 시작

부하 테스트용 환경은 3가지 스펙으로 제공됩니다:

| 스펙 | CPU | Memory | 포트 | 용도 |
|------|-----|--------|------|------|
| **Small** | 0.5 vCPU | 512MB | 3001 | 최소 사양 테스트 |
| **Medium** | 1.0 vCPU | 1GB | 3002 | 권장 사양 테스트 |
| **Large** | 2.0 vCPU | 2GB | 3003 | 고사양 테스트 |

#### Option 1: 전체 환경 시작 (권장)

```bash
# 모든 서비스 시작 (애플리케이션 3개 + DB + Redis + Kafka + 모니터링)
docker compose -f docker-compose.loadtest.yaml up -d

# 상태 확인
docker compose -f docker-compose.loadtest.yaml ps
```

#### Option 2: 특정 스펙만 시작

```bash
# Small 스펙만 테스트
docker compose -f docker-compose.loadtest.yaml up -d mysql redis zookeeper broker1 broker2 broker3 app-small

# Medium 스펙만 테스트
docker compose -f docker-compose.loadtest.yaml up -d mysql redis zookeeper broker1 broker2 broker3 app-medium
```

#### 로그 확인

```bash
# 특정 컨테이너 로그
docker logs -f concert-app-medium

# 모든 애플리케이션 로그
docker compose -f docker-compose.loadtest.yaml logs -f app-small app-medium app-large
```

---

### 2-2. Kafka Topic 생성

```bash
# broker1 컨테이너 접속
docker exec -it broker1 bash

# Topic 생성
kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic payment.completed \
  --partitions 3 \
  --replication-factor 3

kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic reservation.expiration \
  --partitions 3 \
  --replication-factor 3

kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic notification.request \
  --partitions 3 \
  --replication-factor 3

# Topic 확인
kafka-topics --list --bootstrap-server localhost:9092

exit
```

---

### 2-3. 테스트 데이터 삽입

```bash
# MySQL 컨테이너 접속
docker exec -i concert-mysql mysql -uroot -ppassword concert_db < scripts/load-test-data.sql

# 또는 직접 접속하여 실행
docker exec -it concert-mysql mysql -uroot -ppassword concert_db

# 데이터 확인
SELECT COUNT(*) FROM concert WHERE concertId LIKE 'concert_test_%';
SELECT COUNT(*) FROM concert_schedule WHERE scheduleId LIKE 'schedule_test_%';
SELECT COUNT(*) FROM seat WHERE seatId LIKE '%_seat_%';
```

---

### 2-4. 애플리케이션 Health Check

```bash
# Small 스펙 확인
curl http://localhost:3001/health

# Medium 스펙 확인
curl http://localhost:3002/health

# Large 스펙 확인
curl http://localhost:3003/health

# 예상 응답: {"status":"ok"}
```

---

## 3. 테스트 실행

### 3-1. Scenario 1: Queue Spike Test (대기열 토큰 발급)

**목적**: 티켓 오픈 시점의 순간적인 트래픽 급증 테스트

#### Small 스펙 테스트

```bash
k6 run \
  -e BASE_URL=http://localhost:3001 \
  --out json=load-tests/results/01-queue-spike-small.json \
  load-tests/01-queue-spike-test.js
```

#### Medium 스펙 테스트

```bash
k6 run \
  -e BASE_URL=http://localhost:3002 \
  --out json=load-tests/results/01-queue-spike-medium.json \
  load-tests/01-queue-spike-test.js
```

#### Large 스펙 테스트

```bash
k6 run \
  -e BASE_URL=http://localhost:3003 \
  --out json=load-tests/results/01-queue-spike-large.json \
  load-tests/01-queue-spike-test.js
```

**예상 소요 시간**: 약 2분

**모니터링 포인트**:
- CPU 사용률 (50% 미만 권장)
- 메모리 사용량 (80% 미만 권장)
- HTTP 요청 실패율 (1% 미만)
- 응답 시간 P95 (500ms 미만)

---

### 3-2. Scenario 2: Reservation Stress Test (좌석 예약)

**목적**: 분산락 경합 및 DB 커넥션 풀 한계 테스트

#### Medium 스펙 테스트 (권장)

```bash
k6 run \
  -e BASE_URL=http://localhost:3002 \
  --out json=load-tests/results/02-reservation-stress-medium.json \
  load-tests/02-reservation-stress-test.js
```

#### Large 스펙 테스트

```bash
k6 run \
  -e BASE_URL=http://localhost:3003 \
  --out json=load-tests/results/02-reservation-stress-large.json \
  load-tests/02-reservation-stress-test.js
```

**예상 소요 시간**: 약 4분

**모니터링 포인트**:
- 분산락 대기 시간 (Redis 응답 시간)
- DB 커넥션 풀 사용률
- 예약 성공률 vs 충돌률
- 500 에러 발생 여부 (분산락 타임아웃)

**중요**: 이 테스트 후 DB를 초기화해야 다음 테스트가 가능합니다.

```bash
# 테스트 예약 데이터 삭제
docker exec -i concert-mysql mysql -uroot -ppassword concert_db <<EOF
DELETE FROM reservation WHERE reservationId LIKE '%';
UPDATE seat SET status = 'AVAILABLE' WHERE scheduleId LIKE 'schedule_test_%';
EOF
```

---

### 3-3. Scenario 3: Payment Load Test (결제 처리)

**목적**: 지속적인 부하에서 안정성 검증 (메모리 누수, 커넥션 누수 확인)

#### Medium 스펙 테스트 (권장)

```bash
k6 run \
  -e BASE_URL=http://localhost:3002 \
  --out json=load-tests/results/03-payment-load-medium.json \
  load-tests/03-payment-load-test.js
```

**예상 소요 시간**: 약 6분 (5분 Soak + Setup/Teardown)

**모니터링 포인트**:
- 메모리 사용량 추이 (증가 추세 = 메모리 누수)
- DB 커넥션 수 추이 (증가 추세 = 커넥션 누수)
- Kafka Consumer Lag
- 포인트 차감 정확성 (동시성 제어)

---

### 3-4. Scenario 4: Concert Endurance Test (콘서트 조회)

**목적**: 캐시 효율 검증 및 장시간 안정성 확인

#### Small 스펙 테스트 (캐시 효과 확인)

```bash
k6 run \
  -e BASE_URL=http://localhost:3001 \
  --out json=load-tests/results/04-concert-endurance-small.json \
  load-tests/04-concert-endurance-test.js
```

**예상 소요 시간**: 약 32분 (30분 Endurance + Setup/Teardown)

**주의**: 시간이 오래 걸리므로, 빠른 테스트를 원하면 스크립트에서 `30m` → `5m`로 수정하세요.

**모니터링 포인트**:
- 캐시 Hit Rate (95% 이상)
- Redis 메모리 사용량
- 응답 시간 (캐시 히트 시 100ms 이내)
- 에러율 (0.1% 미만)

---

## 4. 리소스별 성능 비교

### 4-1. 비교 테스트 실행 스크립트

모든 스펙에 대해 동일한 테스트를 실행하여 성능을 비교합니다.

```bash
# scripts/run-all-load-tests.sh

#!/bin/bash

echo "====== Load Testing Started ======"
echo "Target: All Specs (Small, Medium, Large)"
echo "Timestamp: $(date)"
echo ""

# Scenario 1: Queue Spike Test
echo "[1/4] Running Queue Spike Test..."

echo "  - Small Spec (0.5CPU, 512MB)"
k6 run -e BASE_URL=http://localhost:3001 \
  --out json=load-tests/results/01-queue-spike-small.json \
  load-tests/01-queue-spike-test.js

echo "  - Medium Spec (1CPU, 1GB)"
k6 run -e BASE_URL=http://localhost:3002 \
  --out json=load-tests/results/01-queue-spike-medium.json \
  load-tests/01-queue-spike-test.js

echo "  - Large Spec (2CPU, 2GB)"
k6 run -e BASE_URL=http://localhost:3003 \
  --out json=load-tests/results/01-queue-spike-large.json \
  load-tests/01-queue-spike-test.js

sleep 10

# Scenario 2: Reservation Stress Test
echo "[2/4] Running Reservation Stress Test..."

echo "  - Medium Spec (1CPU, 1GB)"
k6 run -e BASE_URL=http://localhost:3002 \
  --out json=load-tests/results/02-reservation-stress-medium.json \
  load-tests/02-reservation-stress-test.js

# DB 초기화
docker exec -i concert-mysql mysql -uroot -ppassword concert_db <<EOF
DELETE FROM reservation;
UPDATE seat SET status = 'AVAILABLE' WHERE scheduleId LIKE 'schedule_test_%';
EOF

sleep 10

echo "  - Large Spec (2CPU, 2GB)"
k6 run -e BASE_URL=http://localhost:3003 \
  --out json=load-tests/results/02-reservation-stress-large.json \
  load-tests/02-reservation-stress-test.js

sleep 10

# Scenario 3: Payment Load Test
echo "[3/4] Running Payment Load Test..."

echo "  - Medium Spec (1CPU, 1GB)"
k6 run -e BASE_URL=http://localhost:3002 \
  --out json=load-tests/results/03-payment-load-medium.json \
  load-tests/03-payment-load-test.js

sleep 10

# Scenario 4: Concert Endurance Test (짧은 버전)
echo "[4/4] Running Concert Endurance Test (5min version)..."

echo "  - Small Spec (0.5CPU, 512MB)"
# 30분 → 5분으로 수정된 버전 필요
k6 run -e BASE_URL=http://localhost:3001 \
  --out json=load-tests/results/04-concert-endurance-small.json \
  load-tests/04-concert-endurance-test.js

echo ""
echo "====== Load Testing Completed ======"
echo "Results saved to: load-tests/results/"
echo "Timestamp: $(date)"
```

**실행**:

```bash
chmod +x scripts/run-all-load-tests.sh
./scripts/run-all-load-tests.sh
```

---

### 4-2. 리소스 모니터링

테스트 실행 중 실시간 모니터링:

#### Grafana 대시보드

```
http://localhost:3100
- Username: admin
- Password: admin
```

**주요 메트릭**:
- CPU Usage (%)
- Memory Usage (MB)
- Network I/O
- Disk I/O

#### cAdvisor (컨테이너 메트릭)

```
http://localhost:8080
```

**모니터링 항목**:
- Container CPU Usage
- Container Memory Usage
- Container Network Traffic

#### Prometheus (메트릭 쿼리)

```
http://localhost:9090
```

**유용한 쿼리**:

```promql
# CPU 사용률
rate(container_cpu_usage_seconds_total{name=~"concert-app-.*"}[1m])

# 메모리 사용량
container_memory_usage_bytes{name=~"concert-app-.*"}

# HTTP 요청 수 (애플리케이션이 Prometheus 메트릭을 노출하는 경우)
rate(http_requests_total[1m])
```

---

## 5. 결과 분석

### 5-1. k6 결과 파일 분석

테스트 완료 후 `load-tests/results/` 디렉토리에 JSON 파일이 생성됩니다.

**핵심 메트릭 추출**:

```bash
# Python 스크립트로 결과 요약 (scripts/analyze-k6-results.py 필요)
python scripts/analyze-k6-results.py load-tests/results/01-queue-spike-medium.json
```

**수동 분석**:

JSON 파일에서 확인할 핵심 항목:

```json
{
  "metrics": {
    "http_req_duration": {
      "values": {
        "avg": 245.67,      // 평균 응답 시간
        "min": 12.34,       // 최소 응답 시간
        "med": 198.45,      // 중앙값
        "max": 1234.56,     // 최대 응답 시간
        "p(90)": 456.78,    // 90 백분위수
        "p(95)": 567.89,    // 95 백분위수 ⭐ 중요
        "p(99)": 890.12     // 99 백분위수
      }
    },
    "http_req_failed": {
      "values": {
        "rate": 0.0023      // 실패율 (0.23%)
      }
    },
    "http_reqs": {
      "values": {
        "count": 15234      // 총 요청 수
      }
    }
  }
}
```

---

### 5-2. 스펙별 성능 비교표 작성

테스트 결과를 바탕으로 다음과 같은 비교표를 작성합니다:

| 지표 | Small (0.5CPU, 512MB) | Medium (1CPU, 1GB) | Large (2CPU, 2GB) |
|------|----------------------|-------------------|------------------|
| **Scenario 1: Queue Spike** | | | |
| P95 응답 시간 (ms) | 780 | 420 | 250 |
| 에러율 (%) | 3.5 | 0.8 | 0.1 |
| 처리량 (req/s) | 45 | 95 | 180 |
| **Scenario 2: Reservation** | | | |
| P95 응답 시간 (ms) | N/A (실패) | 1200 | 680 |
| 예약 성공률 (%) | N/A | 92 | 98 |
| 분산락 타임아웃 | N/A | 8% | 2% |
| **Scenario 3: Payment** | | | |
| P95 응답 시간 (ms) | N/A | 650 | 480 |
| 메모리 누수 여부 | N/A | ✗ 없음 | ✗ 없음 |
| **Scenario 4: Concert** | | | |
| 캐시 Hit Rate (%) | 96.5 | 97.2 | 97.8 |
| P95 응답 시간 (ms) | 95 | 78 | 65 |

---

### 5-3. 권장 배포 스펙 결정

**결론 예시**:

> **권장 배포 스펙: Medium (1 vCPU, 1GB RAM)**
>
> - Small 스펙은 Spike 상황에서 에러율 3.5%로 SLA 미달
> - Medium 스펙은 모든 시나리오에서 안정적 성능 (에러율 1% 미만)
> - Large 스펙은 성능 향상이 있으나 비용 대비 효율이 낮음 (40% 성능 향상, 100% 비용 증가)
>
> **배포 전략**:
> - 기본: Medium 스펙 3개 인스턴스 (Auto Scaling)
> - 피크 타임 (티켓 오픈): Large 스펙으로 Scale-Up 또는 Medium 인스턴스 수 증가

---

## 6. 문제 해결

### 6-1. 일반적인 문제

#### 문제 1: k6 실행 시 "connection refused" 에러

**증상**:
```
WARN[0001] Request Failed                               error="Get \"http://localhost:3001/queue/token\": dial tcp [::1]:3001: connect: connection refused"
```

**원인**: 애플리케이션이 아직 시작되지 않았거나 Health Check 실패

**해결**:
```bash
# 컨테이너 상태 확인
docker compose -f docker-compose.loadtest.yaml ps

# 애플리케이션 로그 확인
docker logs concert-app-medium

# Health Check
curl http://localhost:3002/health
```

---

#### 문제 2: DB 커넥션 풀 고갈

**증상**:
```
QueryFailedError: Connection timeout
```

**원인**: 동시 요청 수가 DB 커넥션 풀 크기를 초과

**해결**:
```typescript
// src/database/database.module.ts
extra: {
  connectionLimit: 30, // 10 → 30으로 증가
}
```

또는 테스트 부하를 줄이기:
```javascript
// k6 스크립트에서 VU 수 감소
{ duration: '2m', target: 100 }, // 200 → 100으로 감소
```

---

#### 문제 3: Redis 메모리 부족

**증상**:
```
Error: OOM command not allowed when used memory > 'maxmemory'
```

**원인**: Redis maxmemory 설정 초과

**해결**:
```bash
# docker-compose.loadtest.yaml 수정
command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
# 256mb → 512mb로 증가

# 재시작
docker compose -f docker-compose.loadtest.yaml restart redis
```

---

#### 문제 4: Kafka Consumer Lag 증가

**증상**:
```
[DataPlatformConsumer] Consumer lag: 1500 messages
```

**원인**: Consumer 처리 속도 < Producer 발행 속도

**해결**:
```bash
# Consumer 수 증가 (파티션 수만큼 가능)
# 또는 배치 처리 크기 조정

# Consumer Lag 확인
docker exec -it broker1 kafka-consumer-groups \
  --describe \
  --bootstrap-server localhost:9092 \
  --group data-platform-service-group
```

---

### 6-2. 성능 튜닝 팁

#### Node.js 메모리 제한 증가

```dockerfile
# Dockerfile
CMD ["node", "--max-old-space-size=1024", "dist/main.js"]
# 기본 512MB → 1024MB로 증가
```

#### TypeORM 쿼리 최적화

```typescript
// 인덱스 추가
@Index(['status', 'expiresAt'])
@Entity()
export class Reservation { ... }

// 불필요한 조인 제거
findOne({ where: { reservationId }, relations: [] })
```

#### Redis 파이프라인 사용

```typescript
// 여러 명령을 한 번에 실행
const pipeline = this.redis.pipeline();
pipeline.set('key1', 'value1');
pipeline.set('key2', 'value2');
pipeline.incr('counter');
await pipeline.exec();
```

---

## 7. 다음 단계

1. **부하 테스트 결과 정리**: `load-testing-result-report.md` 작성
2. **성능 개선 적용**: 병목 지점 개선 후 재테스트
3. **프로덕션 배포**: 권장 스펙으로 배포 및 모니터링
4. **정기 부하 테스트**: 월 1회 부하 테스트 실행하여 성능 추이 모니터링

---

**작성일**: 2026-02-28
**작성자**: 콘서트 예약 서비스 개발팀
