import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { ConcertService } from '../../src/concert/concert.service';
import { CacheService } from '../../src/infrastructure/cache/cache.service';

describe('캐시 통합 테스트', () => {
  let app: INestApplication;
  let concertService: ConcertService;
  let cacheService: CacheService;

  const CONCERT_ID = 'concert-001';
  const SCHEDULE_ID = 'schedule-001';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    concertService = moduleRef.get(ConcertService);
    cacheService = moduleRef.get(CacheService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ──────────────────────────────────────────────
  // 1. Cache-Aside 기본 동작 테스트
  // ──────────────────────────────────────────────
  describe('Cache-Aside 기본 동작', () => {
    afterEach(async () => {
      // 테스트 간 캐시 격리
      await cacheService.del(`schedule:${CONCERT_ID}`);
      await cacheService.del(`seats:${SCHEDULE_ID}`);
    });

    it('첫 번째 조회는 DB에서, 이후 조회는 캐시에서 가져온다 (콘서트 일정)', async () => {
      // 캐시가 없는 상태에서 첫 번째 조회 → DB 조회
      const first = await concertService.getAvailableSchedules(CONCERT_ID);
      expect(first.length).toBeGreaterThan(0);

      // 캐시에 저장되었는지 확인
      const cached = await cacheService.get(`schedule:${CONCERT_ID}`);
      expect(cached).not.toBeNull();

      // 두 번째 조회 → 캐시에서 가져옴 (핵심 필드가 동일)
      const second = await concertService.getAvailableSchedules(CONCERT_ID);
      expect(second.length).toBe(first.length);
      expect(second[0].scheduleId).toBe(first[0].scheduleId);
      expect(second[0].concertId).toBe(first[0].concertId);
    });

    it('첫 번째 조회는 DB에서, 이후 조회는 캐시에서 가져온다 (좌석 목록)', async () => {
      const first = await concertService.getAvailableSeats(SCHEDULE_ID);
      expect(first.length).toBe(50);

      const cached = await cacheService.get(`seats:${SCHEDULE_ID}`);
      expect(cached).not.toBeNull();

      // 캐시에서 가져온 데이터의 핵심 필드가 동일
      const second = await concertService.getAvailableSeats(SCHEDULE_ID);
      expect(second.length).toBe(50);
      expect(second[0].seatId).toBe(first[0].seatId);
      expect(second[0].seatNo).toBe(first[0].seatNo);
    });

    it('캐시 무효화 후 다시 DB에서 조회한다', async () => {
      // 캐시 적재
      await concertService.getAvailableSchedules(CONCERT_ID);
      const cached = await cacheService.get(`schedule:${CONCERT_ID}`);
      expect(cached).not.toBeNull();

      // 캐시 무효화
      await cacheService.del(`schedule:${CONCERT_ID}`);
      const afterDel = await cacheService.get(`schedule:${CONCERT_ID}`);
      expect(afterDel).toBeNull();

      // 다시 조회 → DB에서 가져와서 캐시 적재
      const result = await concertService.getAvailableSchedules(CONCERT_ID);
      expect(result.length).toBeGreaterThan(0);

      const reCached = await cacheService.get(`schedule:${CONCERT_ID}`);
      expect(reCached).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // 2. 캐시 성능 개선 측정
  // ──────────────────────────────────────────────
  describe('캐시 성능 개선 측정', () => {
    afterEach(async () => {
      await cacheService.del(`schedule:${CONCERT_ID}`);
      await cacheService.del(`seats:${SCHEDULE_ID}`);
    });

    it('콘서트 일정 조회: 캐시 적용 시 응답 속도가 개선된다', async () => {
      // 캐시 워밍업 (첫 번째 호출은 DB 조회)
      await concertService.getAvailableSchedules(CONCERT_ID);

      // DB 직접 조회 시간 측정 (캐시 삭제 후)
      await cacheService.del(`schedule:${CONCERT_ID}`);
      const dbTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
        await cacheService.del(`schedule:${CONCERT_ID}`);
        const start = performance.now();
        await concertService.getAvailableSchedules(CONCERT_ID);
        dbTimes.push(performance.now() - start);
      }

      // 캐시 조회 시간 측정
      await concertService.getAvailableSchedules(CONCERT_ID); // 캐시 적재
      const cacheTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await concertService.getAvailableSchedules(CONCERT_ID);
        cacheTimes.push(performance.now() - start);
      }

      const avgDb = dbTimes.reduce((a, b) => a + b, 0) / dbTimes.length;
      const avgCache = cacheTimes.reduce((a, b) => a + b, 0) / cacheTimes.length;

      console.log(`[콘서트 일정 조회] DB 평균: ${avgDb.toFixed(2)}ms, 캐시 평균: ${avgCache.toFixed(2)}ms, 개선율: ${((1 - avgCache / avgDb) * 100).toFixed(1)}%`);

      // 캐시가 DB보다 빨라야 한다
      expect(avgCache).toBeLessThan(avgDb);
    });

    it('좌석 목록 조회: 캐시 적용 시 응답 속도가 개선된다', async () => {
      await concertService.getAvailableSeats(SCHEDULE_ID);

      // DB 직접 조회 시간 측정
      await cacheService.del(`seats:${SCHEDULE_ID}`);
      const dbTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
        await cacheService.del(`seats:${SCHEDULE_ID}`);
        const start = performance.now();
        await concertService.getAvailableSeats(SCHEDULE_ID);
        dbTimes.push(performance.now() - start);
      }

      // 캐시 조회 시간 측정
      await concertService.getAvailableSeats(SCHEDULE_ID);
      const cacheTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await concertService.getAvailableSeats(SCHEDULE_ID);
        cacheTimes.push(performance.now() - start);
      }

      const avgDb = dbTimes.reduce((a, b) => a + b, 0) / dbTimes.length;
      const avgCache = cacheTimes.reduce((a, b) => a + b, 0) / cacheTimes.length;

      console.log(`[좌석 목록 조회] DB 평균: ${avgDb.toFixed(2)}ms, 캐시 평균: ${avgCache.toFixed(2)}ms, 개선율: ${((1 - avgCache / avgDb) * 100).toFixed(1)}%`);

      expect(avgCache).toBeLessThan(avgDb);
    });

    it('대량 동시 조회: 캐시 적용 시 DB 부하를 줄인다', async () => {
      // 캐시 적재
      await concertService.getAvailableSchedules(CONCERT_ID);
      await concertService.getAvailableSeats(SCHEDULE_ID);

      // 100건 동시 조회 (캐시 HIT)
      const start = performance.now();
      await Promise.all(
        Array.from({ length: 100 }, () =>
          Promise.all([
            concertService.getAvailableSchedules(CONCERT_ID),
            concertService.getAvailableSeats(SCHEDULE_ID),
          ]),
        ),
      );
      const cachedElapsed = performance.now() - start;

      // 캐시 삭제 후 100건 동시 조회 (DB HIT)
      await cacheService.del(`schedule:${CONCERT_ID}`);
      await cacheService.del(`seats:${SCHEDULE_ID}`);
      const startDb = performance.now();
      await Promise.all(
        Array.from({ length: 100 }, () =>
          Promise.all([
            concertService.getAvailableSchedules(CONCERT_ID),
            concertService.getAvailableSeats(SCHEDULE_ID),
          ]),
        ),
      );
      const dbElapsed = performance.now() - startDb;

      console.log(`[100건 동시 조회] DB: ${dbElapsed.toFixed(2)}ms, 캐시: ${cachedElapsed.toFixed(2)}ms, 개선율: ${((1 - cachedElapsed / dbElapsed) * 100).toFixed(1)}%`);

      // 캐시가 DB보다 빨라야 한다
      expect(cachedElapsed).toBeLessThan(dbElapsed);
    });
  });
});
