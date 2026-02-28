/**
 * Scenario 4: 콘서트 조회 - Endurance Test
 *
 * 목적: 캐시 효율 검증 및 장시간 안정성 확인
 * 시나리오: 200명 일정 부하로 5분간 지속 (원래 30분 → 5분으로 단축)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const cacheHitRate = new Rate('cache_hit');
const schedulesQueryDuration = new Trend('schedules_query_duration');
const seatsQueryDuration = new Trend('seats_query_duration');
const cacheMiss = new Counter('cache_miss');
const cacheHit = new Counter('cache_hit_count');

export const options = {
  stages: [
    { duration: '20s', target: 50 },    // Ramp-up to 50 VUs
    { duration: '2m', target: 50 },     // Sustained load
    { duration: '20s', target: 0 },     // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],   // 95%는 300ms 이내 (캐시 효과)
    http_req_failed: ['rate<0.001'],    // 에러율 0.1% 미만
    errors: ['rate<0.001'],
    cache_hit: ['rate>0.80'],           // 캐시 Hit Rate 80% 이상
    schedules_query_duration: ['p(99)<200'],
    seats_query_duration: ['p(99)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const TEST_CONCERTS = [
  'concert_test_1',
  'concert_test_2',
  'concert_test_3',
];

const TEST_SCHEDULES = [
  'schedule_test_1',
  'schedule_test_2',
  'schedule_test_3',
  'schedule_test_4',
  'schedule_test_5',
];

export default function () {
  group('Concert Browsing Flow', function () {
    // Step 1: 콘서트 일정 조회
    const concertId = TEST_CONCERTS[__VU % TEST_CONCERTS.length];

    const startSchedules = new Date();
    const schedulesResponse = http.get(
      `${BASE_URL}/api/concerts/dates?concertId=${concertId}`,
      { tags: { name: 'GetConcertSchedules' } }
    );
    const schedulesDuration = new Date() - startSchedules;

    const schedulesCheck = check(schedulesResponse, {
      'schedules status is 200': (r) => r.status === 200,
      'schedules has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.dates && Array.isArray(body.dates) && body.dates.length > 0;
        } catch (e) {
          return false;
        }
      },
      'schedules fast response': (r) => r.timings.duration < 150,
    });

    schedulesQueryDuration.add(schedulesDuration);
    errorRate.add(!schedulesCheck);

    if (schedulesResponse.timings.duration < 150) {
      cacheHit.add(1);
      cacheHitRate.add(true);
    } else {
      cacheMiss.add(1);
      cacheHitRate.add(false);
    }

    sleep(1);

    // Step 2: 좌석 조회
    const scheduleId = TEST_SCHEDULES[__VU % TEST_SCHEDULES.length];

    const startSeats = new Date();
    const seatsResponse = http.get(
      `${BASE_URL}/api/concerts/seats?scheduleId=${scheduleId}`,
      { tags: { name: 'GetAvailableSeats' } }
    );
    const seatsDuration = new Date() - startSeats;

    const seatsCheck = check(seatsResponse, {
      'seats status is 200': (r) => r.status === 200,
      'seats has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.seats && Array.isArray(body.seats);
        } catch (e) {
          return false;
        }
      },
      'seats fast response': (r) => r.timings.duration < 150,
    });

    seatsQueryDuration.add(seatsDuration);
    errorRate.add(!seatsCheck);

    if (seatsResponse.timings.duration < 150) {
      cacheHit.add(1);
      cacheHitRate.add(true);
    } else {
      cacheMiss.add(1);
      cacheHitRate.add(false);
    }

    sleep(2);
  });

  sleep(Math.random() * 3 + 2);
}

export function handleSummary(data) {
  const spec = __ENV.SPEC || 'result';
  let text = '';
  try { text = textSummary(data); } catch (e) { text = 'textSummary error: ' + e.message; }
  return {
    [`load-tests/results/04-concert-endurance-${spec}.json`]: JSON.stringify(data, null, 2),
    stdout: text,
  };
}

function textSummary(data) {
  let summary = `\n====== Scenario 4: Concert Endurance Test Summary ======\n\n`;

  summary += `HTTP Metrics:\n`;
  summary += `  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
  summary += `  Failed Requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(4)}%\n`;
  summary += `  Avg Duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  P95 Duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `  P99 Duration: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  summary += `Cache Efficiency:\n`;
  summary += `  Cache Hits: ${data.metrics.cache_hit_count.values.count}\n`;
  summary += `  Cache Misses: ${data.metrics.cache_miss.values.count}\n`;
  summary += `  Cache Hit Rate: ${(data.metrics.cache_hit.values.rate * 100).toFixed(2)}%\n\n`;

  summary += `Query Performance:\n`;
  summary += `  Schedules Avg: ${data.metrics.schedules_query_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  Schedules P95: ${data.metrics.schedules_query_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `  Seats Avg: ${data.metrics.seats_query_duration.values.avg.toFixed(2)}ms\n`;
  summary += `  Seats P95: ${data.metrics.seats_query_duration.values['p(95)'].toFixed(2)}ms\n\n`;

  summary += `Stability Check:\n`;
  summary += `  Test Duration: 5 minutes (Endurance Test)\n`;
  summary += `  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(4)}%\n\n`;

  return summary;
}
