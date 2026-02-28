/**
 * Scenario 3: 결제 처리 - Load Test (Soak Test)
 *
 * 목적: 지속적인 부하에서 안정성 검증 (메모리 누수, 커넥션 누수 확인)
 * 시나리오: 50명 일정 부하로 5분간 지속
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Metrics
const errorRate = new Rate('errors');
const paymentDuration = new Trend('payment_duration');
const paymentSuccess = new Counter('payment_success');
const paymentFailed = new Counter('payment_failed');
const insufficientPointsCount = new Counter('insufficient_points');

export const options = {
  stages: [
    { duration: '30s', target: 50 },    // Ramp-up
    { duration: '5m', target: 50 },     // Sustained load (Soak Test)
    { duration: '30s', target: 0 },     // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],   // 95%는 800ms 이내
    http_req_failed: ['rate<0.02'],     // 에러율 2% 미만
    errors: ['rate<0.02'],
    payment_duration: ['p(99)<1500'],   // 99%는 1.5초 이내
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_SCHEDULE_ID = 'schedule_test_1';
const PAYMENT_AMOUNT = 50000; // 50,000원

// Setup: 각 VU에 대해 포인트 충전 + 예약 생성
export function setup() {
  console.log('Setup: Creating reservations for payment test...');

  const reservations = [];

  // 최소 50개의 예약 생성
  for (let i = 1; i <= 50; i++) {
    const userId = `payment_user_${i}`;

    // Step 1: 토큰 발급
    const tokenResponse = http.post(
      `${BASE_URL}/queue/token`,
      JSON.stringify({ userId }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (tokenResponse.status !== 201) {
      console.error(`Failed to issue token for ${userId}`);
      continue;
    }

    const token = JSON.parse(tokenResponse.body).tokenValue;
    sleep(0.1);

    // Step 2: 포인트 충전 (100,000원)
    const chargeResponse = http.post(
      `${BASE_URL}/points/charge`,
      JSON.stringify({ userId, amount: 100000 }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Queue-Token': token,
        },
      }
    );

    if (chargeResponse.status !== 201) {
      console.error(`Failed to charge points for ${userId}`);
      continue;
    }

    sleep(0.1);

    // Step 3: 좌석 예약
    const reservationResponse = http.post(
      `${BASE_URL}/reservations`,
      JSON.stringify({
        userId,
        scheduleId: TEST_SCHEDULE_ID,
        seatNo: i, // 각 VU마다 다른 좌석
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Queue-Token': token,
        },
      }
    );

    if (reservationResponse.status === 201) {
      const reservation = JSON.parse(reservationResponse.body);
      reservations.push({
        userId,
        token,
        reservationId: reservation.reservationId,
      });
      console.log(`✓ Created reservation for ${userId}: ${reservation.reservationId}`);
    } else {
      console.error(`Failed to create reservation for ${userId}: ${reservationResponse.status}`);
    }

    sleep(0.2);
  }

  console.log(`Setup complete: Created ${reservations.length} reservations`);
  return { reservations };
}

export default function (data) {
  // VU별로 할당된 예약 사용
  const reservationIndex = (__VU - 1) % data.reservations.length;
  const reservation = data.reservations[reservationIndex];

  if (!reservation) {
    console.error(`No reservation available for VU ${__VU}`);
    return;
  }

  group('Payment Flow', function () {
    // Step 1: 포인트 잔액 조회
    const balanceResponse = http.get(
      `${BASE_URL}/points/balance`,
      {
        headers: { 'X-Queue-Token': reservation.token },
        tags: { name: 'GetPointBalance' },
      }
    );

    check(balanceResponse, {
      'balance query success': (r) => r.status === 200,
    });

    sleep(0.3); // 사용자가 잔액 확인하는 시간

    // Step 2: 결제 처리
    const paymentPayload = JSON.stringify({
      reservationId: reservation.reservationId,
      amount: PAYMENT_AMOUNT,
    });

    const startTime = new Date();
    const paymentResponse = http.post(
      `${BASE_URL}/payments`,
      paymentPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Queue-Token': reservation.token,
        },
        tags: { name: 'ProcessPayment' },
      }
    );
    const duration = new Date() - startTime;

    // 응답 검증
    const result = check(paymentResponse, {
      'status is 201 or 400': (r) => [201, 400].includes(r.status),
      'no 500 errors': (r) => r.status !== 500,
      'has payment data': (r) => {
        if (r.status === 201) {
          try {
            const body = JSON.parse(r.body);
            return body.paymentId !== undefined;
          } catch (e) {
            return false;
          }
        }
        return true; // 400은 정상 응답
      },
    });

    // 메트릭 기록
    errorRate.add(!result);
    paymentDuration.add(duration);

    if (paymentResponse.status === 201) {
      paymentSuccess.add(1);
      console.log(`✓ VU ${__VU}: Payment successful for ${reservation.reservationId}`);
    } else if (paymentResponse.status === 400) {
      const errorBody = JSON.parse(paymentResponse.body);
      if (errorBody.message && errorBody.message.includes('포인트')) {
        insufficientPointsCount.add(1);
        console.log(`⚠ VU ${__VU}: Insufficient points`);
      } else {
        paymentFailed.add(1);
        console.error(`✗ VU ${__VU}: Payment failed - ${errorBody.message}`);
      }
    } else {
      paymentFailed.add(1);
      console.error(`✗ VU ${__VU}: Payment error - ${paymentResponse.status}`);
    }
  });

  // Think Time
  sleep(Math.random() * 4 + 3); // 3~7초
}

export function handleSummary(data) {
  return {
    'load-tests/results/03-payment-load-test-result.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
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

  summary += `Memory & Stability Check:\n`;
  summary += `  Test Duration: 5 minutes (Soak Test)\n`;
  summary += `  Check application logs for memory leaks or connection pool issues\n\n`;

  return summary;
}
