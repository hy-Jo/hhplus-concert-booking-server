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
const reservationConflict = new Counter('reservation_conflict');
const reservationFailed = new Counter('reservation_failed');
const activeVUs = new Gauge('active_vus');

export const options = {
  stages: [
    { duration: '20s', target: 20 },    // Phase 1: 정상 부하
    { duration: '30s', target: 50 },    // Phase 2: 증가된 부하
    { duration: '1m', target: 50 },     // Phase 3: 부하 유지
    { duration: '20s', target: 0 },     // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // 95%는 1초 이내
    http_req_failed: ['rate<0.05'],     // 에러율 5% 미만
    errors: ['rate<0.05'],
    reservation_duration: ['p(99)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_SCHEDULE_ID = 'schedule_test_1';
const TOTAL_SEATS = 50;

// Setup: 테스트 시작 전 사용자 토큰 발급
export function setup() {
  console.log('Setup: Issuing tokens for VUs...');
  const tokens = [];

  for (let i = 1; i <= 50; i++) {
    const response = http.post(
      `${BASE_URL}/api/queue/token`,
      JSON.stringify({ userId: `loadtest_user_${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (response.status === 201) {
      const body = JSON.parse(response.body);
      tokens.push({
        userId: `loadtest_user_${i}`,
        token: body.token,
      });
    }

    sleep(0.1);
  }

  console.log(`Setup complete: Issued ${tokens.length} tokens`);
  return { tokens };
}

export default function (data) {
  activeVUs.add(__VU);

  const tokenIndex = (__VU - 1) % data.tokens.length;
  const userToken = data.tokens[tokenIndex];

  if (!userToken) {
    console.error(`No token available for VU ${__VU}`);
    return;
  }

  group('Seat Reservation Flow', function () {
    // Step 1: 좌석 조회
    const seatsResponse = http.get(
      `${BASE_URL}/api/concerts/seats?scheduleId=${TEST_SCHEDULE_ID}`,
      { tags: { name: 'GetAvailableSeats' } }
    );

    check(seatsResponse, {
      'seats query success': (r) => r.status === 200,
    });

    // Step 2: 랜덤 좌석 선택 (경합 유발)
    const seatNo = Math.floor(Math.random() * TOTAL_SEATS) + 1;

    sleep(0.5);

    // Step 3: 좌석 예약
    const reservationPayload = JSON.stringify({
      userId: userToken.userId,
      scheduleId: TEST_SCHEDULE_ID,
      seatNo: seatNo,
    });

    const startTime = new Date();
    const reservationResponse = http.post(
      `${BASE_URL}/api/reservations`,
      reservationPayload,
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'CreateReservation' },
      }
    );
    const duration = new Date() - startTime;

    const result = check(reservationResponse, {
      'status is 201 or 4xx': (r) => r.status === 201 || (r.status >= 400 && r.status < 500),
      'no 500 errors': (r) => r.status !== 500,
      'response has body': (r) => r.body && r.body.length > 0,
    });

    errorRate.add(!result);
    reservationDuration.add(duration);

    if (reservationResponse.status === 201) {
      reservationSuccess.add(1);
    } else if (reservationResponse.status >= 400 && reservationResponse.status < 500) {
      reservationConflict.add(1);
    } else {
      reservationFailed.add(1);
      console.error(`VU ${__VU}: Reservation error - ${reservationResponse.status}`);
    }
  });

  sleep(Math.random() * 3 + 2);
}

export function handleSummary(data) {
  const spec = __ENV.SPEC || 'result';
  let text = '';
  try { text = textSummary(data); } catch (e) { text = 'textSummary error: ' + e.message; }
  return {
    [`load-tests/results/02-reservation-stress-${spec}.json`]: JSON.stringify(data, null, 2),
    stdout: text,
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
