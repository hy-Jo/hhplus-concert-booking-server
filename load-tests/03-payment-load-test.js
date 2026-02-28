/**
 * Scenario 3: 결제 처리 - Load Test (Soak Test)
 *
 * 목적: 지속적인 부하에서 안정성 검증 (메모리 누수, 커넥션 누수 확인)
 * 시나리오: 50명 일정 부하로 3분간 지속
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const paymentDuration = new Trend('payment_duration');
const paymentSuccess = new Counter('payment_success');
const paymentFailed = new Counter('payment_failed');
const insufficientPointsCount = new Counter('insufficient_points');

export const options = {
  stages: [
    { duration: '20s', target: 20 },    // Ramp-up
    { duration: '1m30s', target: 20 },  // Sustained load
    { duration: '20s', target: 0 },     // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.02'],
    errors: ['rate<0.02'],
    payment_duration: ['p(99)<1500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_SCHEDULE_ID = 'schedule_test_2'; // 다른 일정 사용 (Scenario 2와 충돌 방지)
const PAYMENT_AMOUNT = 50000;

export function setup() {
  console.log('Setup: Creating reservations for payment test...');
  const reservations = [];

  for (let i = 1; i <= 20; i++) {
    const userId = `payment_user_${i}`;

    // Step 1: 토큰 발급
    const tokenResponse = http.post(
      `${BASE_URL}/api/queue/token`,
      JSON.stringify({ userId }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (tokenResponse.status !== 201) {
      console.error(`Failed to issue token for ${userId}: ${tokenResponse.status}`);
      continue;
    }

    const token = JSON.parse(tokenResponse.body).token;
    sleep(0.1);

    // Step 2: 포인트 충전
    const chargeResponse = http.post(
      `${BASE_URL}/api/points/charge`,
      JSON.stringify({ userId, amount: 100000 }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (chargeResponse.status !== 201) {
      console.error(`Failed to charge points for ${userId}: ${chargeResponse.status} - ${chargeResponse.body}`);
      continue;
    }

    sleep(0.1);

    // Step 3: 좌석 예약
    const reservationResponse = http.post(
      `${BASE_URL}/api/reservations`,
      JSON.stringify({
        userId,
        scheduleId: TEST_SCHEDULE_ID,
        seatNo: i,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (reservationResponse.status === 201) {
      const reservation = JSON.parse(reservationResponse.body);
      reservations.push({
        userId,
        token,
        reservationId: reservation.reservationId,
      });
      console.log(`Created reservation for ${userId}: ${reservation.reservationId}`);
    } else {
      console.error(`Failed to create reservation for ${userId}: ${reservationResponse.status} - ${reservationResponse.body}`);
    }

    sleep(0.2);
  }

  console.log(`Setup complete: Created ${reservations.length} reservations`);
  return { reservations };
}

export default function (data) {
  const reservationIndex = (__VU - 1) % data.reservations.length;
  const reservation = data.reservations[reservationIndex];

  if (!reservation) {
    console.error(`No reservation available for VU ${__VU}`);
    return;
  }

  group('Payment Flow', function () {
    // Step 1: 포인트 잔액 조회
    const balanceResponse = http.get(
      `${BASE_URL}/api/points/balance?userId=${reservation.userId}`,
      { tags: { name: 'GetPointBalance' } }
    );

    check(balanceResponse, {
      'balance query success': (r) => r.status === 200,
    });

    sleep(0.3);

    // Step 2: 결제 처리
    const startTime = new Date();
    const paymentResponse = http.post(
      `${BASE_URL}/api/payments`,
      JSON.stringify({
        userId: reservation.userId,
        reservationId: reservation.reservationId,
        amount: PAYMENT_AMOUNT,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'ProcessPayment' },
      }
    );
    const duration = new Date() - startTime;

    const result = check(paymentResponse, {
      'status is 201 or 4xx': (r) => r.status === 201 || (r.status >= 400 && r.status < 500),
      'no 500 errors': (r) => r.status !== 500,
    });

    errorRate.add(!result);
    paymentDuration.add(duration);

    if (paymentResponse.status === 201) {
      paymentSuccess.add(1);
    } else if (paymentResponse.status >= 400 && paymentResponse.status < 500) {
      const errorBody = JSON.parse(paymentResponse.body || '{}');
      if (errorBody.message && errorBody.message.includes('포인트')) {
        insufficientPointsCount.add(1);
      } else {
        paymentFailed.add(1);
      }
    } else {
      paymentFailed.add(1);
      console.error(`Payment error ${paymentResponse.status}: ${paymentResponse.body}`);
    }
  });

  sleep(Math.random() * 4 + 3);
}

export function handleSummary(data) {
  const spec = __ENV.SPEC || 'result';
  let text = '';
  try { text = textSummary(data); } catch (e) { text = 'textSummary error: ' + e.message; }
  return {
    [`load-tests/results/03-payment-load-${spec}.json`]: JSON.stringify(data, null, 2),
    stdout: text,
  };
}

function textSummary(data) {
  let summary = `\n====== Scenario 3: Payment Load Test Summary ======\n\n`;

  summary += `HTTP Metrics:\n`;
  summary += `  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
  summary += `  Failed Requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
  summary += `  Avg Duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  P95 Duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `  P99 Duration: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  summary += `Payment Metrics:\n`;
  summary += `  Success: ${data.metrics.payment_success.values.count}\n`;
  summary += `  Failed: ${data.metrics.payment_failed.values.count}\n`;
  summary += `  Insufficient Points: ${data.metrics.insufficient_points.values.count}\n`;
  summary += `  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%\n\n`;

  summary += `Transaction Performance:\n`;
  summary += `  Avg Payment Duration: ${data.metrics.payment_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  P95 Payment Duration: ${data.metrics.payment_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `  P99 Payment Duration: ${data.metrics.payment_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  return summary;
}
