/**
 * Scenario 1: 대기열 토큰 발급 - Spike Test
 *
 * 목적: 티켓 오픈 시점의 순간적인 트래픽 급증 테스트
 * 시나리오: 10초 → 100명, 30초 → 1000명 급증, 1분 유지, 10초 종료
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Metrics
const errorRate = new Rate('errors');
const tokenIssueDuration = new Trend('token_issue_duration');
const tokenIssueSuccess = new Counter('token_issue_success');
const tokenIssueFailed = new Counter('token_issue_failed');

export const options = {
  stages: [
    { duration: '10s', target: 20 },    // Warm-up: 10초간 20명까지 증가
    { duration: '20s', target: 100 },   // Spike: 20초간 100명까지 급증 (티켓 오픈)
    { duration: '30s', target: 100 },   // Sustain: 30초간 100명 유지
    { duration: '10s', target: 0 },     // Ramp-down: 10초간 종료
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95%는 500ms 이내 응답
    http_req_failed: ['rate<0.01'],     // 에러율 1% 미만
    errors: ['rate<0.01'],              // 커스텀 에러율 1% 미만
    token_issue_duration: ['p(99)<1000'], // 99%는 1초 이내
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// 환경 변수 (실행 시 -e 옵션으로 전달 가능)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Virtual User ID와 Iteration을 조합하여 고유한 userId 생성
  const userId = `user_${__VU}_${__ITER}`;

  const payload = JSON.stringify({ userId });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'IssueQueueToken' },
  };

  // 대기열 토큰 발급 요청
  const startTime = new Date();
  const response = http.post(`${BASE_URL}/api/queue/token`, payload, params);
  const duration = new Date() - startTime;

  // 응답 검증
  const result = check(response, {
    'status is 201': (r) => r.status === 201,
    'has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.token !== undefined;
      } catch (e) {
        return false;
      }
    },
    'has queuePosition': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.queuePosition === 'number';
      } catch (e) {
        return false;
      }
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  // 메트릭 기록
  errorRate.add(!result);
  tokenIssueDuration.add(duration);

  if (response.status === 201) {
    tokenIssueSuccess.add(1);
  } else {
    tokenIssueFailed.add(1);
    console.error(`Token issue failed: ${response.status} - ${response.body}`);
  }

  // Think Time
  sleep(Math.random() * 2 + 1); // 1~3초 랜덤 대기
}

export function handleSummary(data) {
  const spec = __ENV.SPEC || 'result';
  let text = '';
  try { text = textSummary(data); } catch (e) { text = 'textSummary error: ' + e.message; }
  return {
    [`load-tests/results/01-queue-spike-${spec}.json`]: JSON.stringify(data, null, 2),
    stdout: text,
  };
}

function textSummary(data) {
  const indent = ' ';
  let summary = `\n${indent}====== Scenario 1: Queue Spike Test Summary ======\n\n`;

  summary += `${indent}HTTP Metrics:\n`;
  summary += `${indent}  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
  summary += `${indent}  Failed Requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
  summary += `${indent}  Avg Duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
  summary += `${indent}  P95 Duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `${indent}  P99 Duration: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  summary += `${indent}Token Issue Metrics:\n`;
  summary += `${indent}  Success: ${data.metrics.token_issue_success.values.count}\n`;
  summary += `${indent}  Failed: ${data.metrics.token_issue_failed.values.count}\n`;
  summary += `${indent}  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%\n\n`;

  summary += `${indent}Thresholds:\n`;
  for (const [name, metric] of Object.entries(data.metrics)) {
    if (metric.thresholds) {
      for (const [thName, thValue] of Object.entries(metric.thresholds)) {
        const passed = thValue.ok ? '✓' : '✗';
        summary += `${indent}  ${passed} ${name} ${thName}\n`;
      }
    }
  }

  return summary;
}
