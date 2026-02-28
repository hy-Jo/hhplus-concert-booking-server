/**
 * Scenario 2: 좌석 예약 - Stress Test
 *
 * 목적: 분산락 경합 및 DB 커넥션 풀 한계 테스트
 * 시나리오: 50명 → 100명 → 200명 점진적 증가 (시스템 한계 확인)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom Metrics
const errorRate = new Rate('errors');
const reservationDuration = new Trend('reservation_duration');
const reservationSuccess = new Counter('reservation_success');
const reservationConflict = new Counter('reservation_conflict'); // 이미 예약된 좌석
const reservationFailed = new Counter('reservation_failed');
const activeVUs = new Gauge('active_vus');

export const options = {
  stages: [
    { duration: '30s', target: 50 },    // Phase 1: 정상 부하 (MAX_ACTIVE_TOKENS)
    { duration: '1m', target: 100 },    // Phase 2: 증가된 부하
    { duration: '2m', target: 200 },    // Phase 3: 과부하 (Stress)
    { duration: '30s', target: 0 },     // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // 95%는 1초 이내
    http_req_failed: ['rate<0.05'],     // 에러율 5% 미만 (분산락 경합 고려)
    errors: ['rate<0.05'],
    reservation_duration: ['p(99)<2000'], // 99%는 2초 이내
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// 테스트용 콘서트 데이터 (사전에 DB에 입력되어 있어야 함)
const TEST_CONCERT_ID = 'concert_test_1';
const TEST_SCHEDULE_ID = 'schedule_test_1';
const TOTAL_SEATS = 50; // 전체 좌석 수

// Setup: 테스트 시작 전 ACTIVE 토큰 발급
export function setup() {
  console.log('Setup: Issuing ACTIVE tokens for VUs...');

  // 각 VU가 사용할 토큰을 사전 발급
  // 실제 환경에서는 대기열을 거쳐 ACTIVE 상태가 되어야 함
  const tokens = [];

  // 최소 200개의 토큰 발급 (VU 수에 맞춤)
  for (let i = 1; i <= 200; i++) {
    const response = http.post(
      `${BASE_URL}/queue/token`,
      JSON.stringify({ userId: `loadtest_user_${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (response.status === 201) {
      const body = JSON.parse(response.body);
      tokens.push({
        userId: `loadtest_user_${i}`,
        token: body.tokenValue,
      });
    }

    // Rate limiting 방지
    sleep(0.1);
  }

  console.log(`Setup complete: Issued ${tokens.length} tokens`);
  return { tokens };
}

export default function (data) {
  activeVUs.add(__VU);

  // VU별로 할당된 토큰 사용
  const tokenIndex = (__VU - 1) % data.tokens.length;
  const userToken = data.tokens[tokenIndex];

  if (!userToken) {
    console.error(`No token available for VU ${__VU}`);
    return;
  }

  group('Seat Reservation Flow', function () {
    // Step 1: 좌석 조회
    const seatsResponse = http.get(
      `${BASE_URL}/concerts/schedules/${TEST_SCHEDULE_ID}/seats`,
      {
        headers: { 'X-Queue-Token': userToken.token },
        tags: { name: 'GetAvailableSeats' },
      }
    );

    check(seatsResponse, {
      'seats query success': (r) => r.status === 200,
    });

    // Step 2: 랜덤 좌석 선택 (경합 유발)
    const seatNo = Math.floor(Math.random() * TOTAL_SEATS) + 1; // 1~50

    sleep(0.5); // 사용자가 좌석을 고르는 시간

    // Step 3: 좌석 예약 시도
    const reservationPayload = JSON.stringify({
      userId: userToken.userId,
      scheduleId: TEST_SCHEDULE_ID,
      seatNo: seatNo,
    });

    const startTime = new Date();
    const reservationResponse = http.post(
      `${BASE_URL}/reservations`,
      reservationPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Queue-Token': userToken.token,
        },
        tags: { name: 'CreateReservation' },
      }
    );
    const duration = new Date() - startTime;

    // 응답 검증
    const result = check(reservationResponse, {
      'status is 201 or 400': (r) => [201, 400].includes(r.status),
      'no 500 errors': (r) => r.status !== 500,
      'response has body': (r) => r.body && r.body.length > 0,
    });

    // 메트릭 기록
    errorRate.add(!result);
    reservationDuration.add(duration);

    if (reservationResponse.status === 201) {
      reservationSuccess.add(1);
      console.log(`✓ VU ${__VU}: Reserved seat ${seatNo}`);
    } else if (reservationResponse.status === 400) {
      // 이미 예약된 좌석 (정상적인 경합 결과)
      reservationConflict.add(1);
      console.log(`⚠ VU ${__VU}: Seat ${seatNo} already reserved`);
    } else {
      // 실제 에러 (500, 503 등)
      reservationFailed.add(1);
      console.error(`✗ VU ${__VU}: Reservation failed - ${reservationResponse.status}`);
    }
  });

  // Think Time
  sleep(Math.random() * 3 + 2); // 2~5초
}

export function handleSummary(data) {
  return {
    'load-tests/results/02-reservation-stress-test-result.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  let summary = `\n====== Scenario 2: Reservation Stress Test Summary ======\n\n`;

  summary += `HTTP Metrics:\n`;
  summary += `  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
  summary += `  Failed Requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
  summary += `  Avg Duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  P95 Duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `  P99 Duration: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  summary += `Reservation Metrics:\n`;
  summary += `  Success: ${data.metrics.reservation_success.values.count}\n`;
  summary += `  Conflict (Already Reserved): ${data.metrics.reservation_conflict.values.count}\n`;
  summary += `  Failed (Error): ${data.metrics.reservation_failed.values.count}\n`;
  summary += `  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%\n\n`;

  summary += `Distributed Lock Performance:\n`;
  summary += `  Avg Reservation Duration: ${data.metrics.reservation_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  P95 Reservation Duration: ${data.metrics.reservation_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `  P99 Reservation Duration: ${data.metrics.reservation_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  return summary;
}
