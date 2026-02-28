/**
 * Scenario 4: 콘서트 조회 - Endurance Test
 *
 * 목적: 캐시 효율 검증 및 장시간 안정성 확인
 * 시나리오: 500명 일정 부하로 30분간 지속
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Metrics
const errorRate = new Rate('errors');
const cacheHitRate = new Rate('cache_hit');
const schedulesQueryDuration = new Trend('schedules_query_duration');
const seatsQueryDuration = new Trend('seats_query_duration');
const cacheMiss = new Counter('cache_miss');
const cacheHit = new Counter('cache_hit_count');

export const options = {
  stages: [
    { duration: '1m', target: 500 },    // Ramp-up to 500 VUs
    { duration: '30m', target: 500 },   // Sustained load for 30 minutes
    { duration: '1m', target: 0 },      // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],   // 95%는 200ms 이내 (캐시 효과)
    http_req_failed: ['rate<0.001'],    // 에러율 0.1% 미만
    errors: ['rate<0.001'],
    cache_hit: ['rate>0.95'],           // 캐시 Hit Rate 95% 이상
    schedules_query_duration: ['p(99)<150'], // 99%는 150ms 이내
    seats_query_duration: ['p(99)<150'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// 테스트용 콘서트 데이터 (다양한 콘서트 조회로 캐시 효과 측정)
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
    // Step 1: 콘서트 목록 조회 (실제 API에 맞게 수정 필요)
    // 여기서는 특정 콘서트의 일정 조회로 대체

    const concertId = TEST_CONCERTS[__VU % TEST_CONCERTS.length];

    const startSchedules = new Date();
    const schedulesResponse = http.get(
      `${BASE_URL}/concerts/${concertId}/schedules`,
      {
        tags: { name: 'GetConcertSchedules' },
      }
    );
    const schedulesDuration = new Date() - startSchedules;

    const schedulesCheck = check(schedulesResponse, {
      'schedules status is 200': (r) => r.status === 200,
      'schedules has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body) && body.length > 0;
        } catch (e) {
          return false;
        }
      },
      'schedules fast response': (r) => r.timings.duration < 100, // 캐시 히트 시 100ms 이내
    });

    schedulesQueryDuration.add(schedulesDuration);
    errorRate.add(!schedulesCheck);

    // 캐시 히트 판단 (응답 시간 기준)
    if (schedulesResponse.timings.duration < 100) {
      cacheHit.add(1);
      cacheHitRate.add(true);
    } else {
      cacheMiss.add(1);
      cacheHitRate.add(false);
    }

    sleep(1); // 사용자가 일정을 보는 시간

    // Step 2: 특정 일정의 좌석 조회
    const scheduleId = TEST_SCHEDULES[__VU % TEST_SCHEDULES.length];

    const startSeats = new Date();
    const seatsResponse = http.get(
      `${BASE_URL}/concerts/schedules/${scheduleId}/seats`,
      {
        tags: { name: 'GetAvailableSeats' },
      }
    );
    const seatsuration = new Date() - startSeats;

    const seatsCheck = check(seatsResponse, {
      'seats status is 200': (r) => r.status === 200,
      'seats has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body);
        } catch (e) {
          return false;
        }
      },
      'seats fast response': (r) => r.timings.duration < 100,
    });

    seatsQueryDuration.add(seatsuration);
    errorRate.add(!seatsCheck);

    // 캐시 히트 판단
    if (seatsResponse.timings.duration < 100) {
      cacheHit.add(1);
      cacheHitRate.add(true);
    } else {
      cacheMiss.add(1);
      cacheHitRate.add(false);
    }

    sleep(2); // 사용자가 좌석을 고르는 시간
  });

  // Think Time (사용자가 다른 페이지를 보거나 고민하는 시간)
  sleep(Math.random() * 5 + 3); // 3~8초
}

export function handleSummary(data) {
  return {
    'load-tests/results/04-concert-endurance-test-result.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
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
  summary += `  Test Duration: 30 minutes (Endurance Test)\n`;
  summary += `  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(4)}%\n`;
  summary += `  Check Redis memory usage and application stability\n\n`;

  return summary;
}
