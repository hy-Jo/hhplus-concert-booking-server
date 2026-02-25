import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { RankingService } from '../../src/ranking/ranking.service';
import Redis from 'ioredis';

describe('랭킹 통합 테스트', () => {
  let app: INestApplication;
  let rankingService: RankingService;
  let redis: Redis;

  const SCHEDULE_ID = 'schedule-001';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    rankingService = moduleRef.get(RankingService);
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    });
  });

  afterAll(async () => {
    await redis.quit();
    await app.close();
  });

  afterEach(async () => {
    // 테스트 간 Redis 랭킹 데이터 격리
    await redis.del('ranking:reservation-count');
    await redis.del('ranking:sold-out-speed');
    const keys = await redis.keys('ranking:first-reservation:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  // ──────────────────────────────────────────────
  // 1. 예약 확정 시 랭킹 갱신 테스트
  // ──────────────────────────────────────────────
  describe('예약 확정 시 랭킹 갱신', () => {
    it('결제 확정 시 예약 수가 증가한다', async () => {
      // when
      await rankingService.onReservationConfirmed(SCHEDULE_ID);
      await rankingService.onReservationConfirmed(SCHEDULE_ID);
      await rankingService.onReservationConfirmed(SCHEDULE_ID);

      // then
      const score = await redis.zscore('ranking:reservation-count', SCHEDULE_ID);
      expect(Number(score)).toBe(3);
    });

    it('첫 예약 시각이 기록된다', async () => {
      // when
      await rankingService.onReservationConfirmed(SCHEDULE_ID);

      // then
      const firstTime = await redis.get(`ranking:first-reservation:${SCHEDULE_ID}`);
      expect(firstTime).not.toBeNull();
      expect(Number(firstTime)).toBeGreaterThan(0);
    });

    it('50번째 예약(매진) 시 매진 소요 시간이 기록된다', async () => {
      // given: 49석 예약
      for (let i = 0; i < 49; i++) {
        await rankingService.onReservationConfirmed(SCHEDULE_ID);
      }

      // 매진 전에는 sold-out-speed에 기록되지 않음
      const beforeSoldOut = await redis.zscore('ranking:sold-out-speed', SCHEDULE_ID);
      expect(beforeSoldOut).toBeNull();

      // when: 50번째 예약 (매진)
      await rankingService.onReservationConfirmed(SCHEDULE_ID);

      // then: 매진 속도가 기록됨
      const soldOutScore = await redis.zscore('ranking:sold-out-speed', SCHEDULE_ID);
      expect(soldOutScore).not.toBeNull();
      expect(Number(soldOutScore)).toBeGreaterThanOrEqual(0);
    });
  });

  // ──────────────────────────────────────────────
  // 2. 랭킹 조회 테스트
  // ──────────────────────────────────────────────
  describe('랭킹 조회', () => {
    it('인기 콘서트 랭킹을 예약 수 내림차순으로 조회한다', async () => {
      // given: 여러 스케줄에 다른 수의 예약
      for (let i = 0; i < 30; i++) {
        await rankingService.onReservationConfirmed('schedule-A');
      }
      for (let i = 0; i < 10; i++) {
        await rankingService.onReservationConfirmed('schedule-B');
      }
      for (let i = 0; i < 20; i++) {
        await rankingService.onReservationConfirmed('schedule-C');
      }

      // when
      const ranking = await rankingService.getPopularRanking(10);

      // then: 예약 수 내림차순
      expect(ranking).toHaveLength(3);
      expect(ranking[0].scheduleId).toBe('schedule-A');
      expect(ranking[0].score).toBe(30);
      expect(ranking[1].scheduleId).toBe('schedule-C');
      expect(ranking[1].score).toBe(20);
      expect(ranking[2].scheduleId).toBe('schedule-B');
      expect(ranking[2].score).toBe(10);
    });

    it('매진 속도 랭킹을 빠른 순(오름차순)으로 조회한다', async () => {
      // given: 직접 Redis에 매진 속도 데이터 삽입
      await redis.zadd('ranking:sold-out-speed', 120, 'schedule-slow');    // 120초
      await redis.zadd('ranking:sold-out-speed', 30, 'schedule-fast');     // 30초
      await redis.zadd('ranking:sold-out-speed', 60, 'schedule-medium');   // 60초

      // when
      const ranking = await rankingService.getSoldOutRanking(10);

      // then: 빠른 순 (score 오름차순)
      expect(ranking).toHaveLength(3);
      expect(ranking[0].scheduleId).toBe('schedule-fast');
      expect(ranking[0].score).toBe(30);
      expect(ranking[1].scheduleId).toBe('schedule-medium');
      expect(ranking[1].score).toBe(60);
      expect(ranking[2].scheduleId).toBe('schedule-slow');
      expect(ranking[2].score).toBe(120);
    });

    it('limit 파라미터로 조회 개수를 제한할 수 있다', async () => {
      // given
      for (let i = 0; i < 5; i++) {
        await redis.zadd('ranking:sold-out-speed', (i + 1) * 10, `schedule-${i}`);
      }

      // when
      const ranking = await rankingService.getSoldOutRanking(3);

      // then
      expect(ranking).toHaveLength(3);
    });
  });

  // ──────────────────────────────────────────────
  // 3. 동시성 테스트
  // ──────────────────────────────────────────────
  describe('동시 예약 확정 시 랭킹 정확성', () => {
    it('50건 동시 예약 확정 시 예약 수가 정확히 50이다', async () => {
      // when: 50건 동시 예약 확정
      await Promise.all(
        Array.from({ length: 50 }, () =>
          rankingService.onReservationConfirmed(SCHEDULE_ID),
        ),
      );

      // then
      const score = await redis.zscore('ranking:reservation-count', SCHEDULE_ID);
      expect(Number(score)).toBe(50);
    });
  });
});
