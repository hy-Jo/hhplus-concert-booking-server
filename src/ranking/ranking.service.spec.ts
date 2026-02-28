import { RankingService } from './ranking.service';
import { ConcertRepository } from '../concert/concert.repository';
import { ConcertSchedule } from '../concert/domain/concert-schedule.entity';
import { Concert } from '../concert/domain/concert.entity';

describe('RankingService', () => {
  let service: RankingService;
  let mockRedis: Record<string, jest.Mock>;
  let mockConcertRepository: jest.Mocked<ConcertRepository>;

  beforeEach(() => {
    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      zincrby: jest.fn().mockResolvedValue('1'),
      zadd: jest.fn().mockResolvedValue(1),
      zrange: jest.fn().mockResolvedValue([]),
      zrevrange: jest.fn().mockResolvedValue([]),
    };

    mockConcertRepository = {
      findSchedulesByConcertId: jest.fn(),
      findAvailableSeats: jest.fn(),
      findSeatByScheduleAndNo: jest.fn(),
      findScheduleWithConcert: jest.fn(),
      findScheduleIdBySeatId: jest.fn(),
    };

    service = new RankingService(
      mockRedis as any,
      mockConcertRepository,
    );
  });

  describe('onReservationConfirmed', () => {
    it('결제 확정 시 예약 수를 +1 증가시킨다', async () => {
      // given
      const scheduleId = 'schedule-001';
      mockRedis.zincrby.mockResolvedValue('1');

      // when
      await service.onReservationConfirmed(scheduleId);

      // then
      expect(mockRedis.zincrby).toHaveBeenCalledWith(
        'ranking:reservation-count',
        1,
        scheduleId,
      );
    });

    it('첫 예약 시 첫 예약 시각을 NX로 기록한다', async () => {
      // given
      const scheduleId = 'schedule-001';
      mockRedis.zincrby.mockResolvedValue('1');

      // when
      await service.onReservationConfirmed(scheduleId);

      // then
      expect(mockRedis.set).toHaveBeenCalledWith(
        `ranking:first-reservation:${scheduleId}`,
        expect.any(String),
        'PX',
        24 * 60 * 60 * 1000,
        'NX',
      );
    });

    it('50번째 예약(매진) 시 매진 소요 시간을 기록한다', async () => {
      // given
      const scheduleId = 'schedule-001';
      const firstReservationTime = (Date.now() - 60000).toString(); // 60초 전
      mockRedis.zincrby.mockResolvedValue('50');
      mockRedis.get.mockResolvedValue(firstReservationTime);

      // when
      await service.onReservationConfirmed(scheduleId);

      // then
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'ranking:sold-out-speed',
        'NX',
        expect.any(Number),
        scheduleId,
      );
      // 매진 소요 시간이 약 60초 (오차 허용)
      const soldOutDuration = mockRedis.zadd.mock.calls[0][2];
      expect(soldOutDuration).toBeGreaterThanOrEqual(59);
      expect(soldOutDuration).toBeLessThanOrEqual(61);
    });

    it('매진 전(49석 이하)에는 매진 속도를 기록하지 않는다', async () => {
      // given
      const scheduleId = 'schedule-001';
      mockRedis.zincrby.mockResolvedValue('49');

      // when
      await service.onReservationConfirmed(scheduleId);

      // then
      expect(mockRedis.zadd).not.toHaveBeenCalled();
    });
  });

  describe('getSoldOutRanking', () => {
    it('매진 속도 랭킹을 빠른 순서로 조회한다', async () => {
      // given
      const mockSchedule = {
        scheduleId: 'schedule-001',
        concertId: 'concert-001',
        concertDate: '2024-12-25',
        concert: { title: '연말 콘서트' } as Concert,
      } as ConcertSchedule;

      mockRedis.zrange.mockResolvedValue(['schedule-001', '30']);
      mockConcertRepository.findScheduleWithConcert.mockResolvedValue(mockSchedule);

      // when
      const result = await service.getSoldOutRanking(10);

      // then
      expect(result).toHaveLength(1);
      expect(result[0].scheduleId).toBe('schedule-001');
      expect(result[0].concertTitle).toBe('연말 콘서트');
      expect(result[0].concertDate).toBe('2024-12-25');
      expect(result[0].score).toBe(30);
    });

    it('매진된 콘서트가 없으면 빈 배열을 반환한다', async () => {
      // given
      mockRedis.zrange.mockResolvedValue([]);

      // when
      const result = await service.getSoldOutRanking(10);

      // then
      expect(result).toHaveLength(0);
    });
  });

  describe('getPopularRanking', () => {
    it('예약 수가 많은 순서로 인기 랭킹을 조회한다', async () => {
      // given
      const mockSchedule1 = {
        scheduleId: 'schedule-001',
        concertDate: '2024-12-25',
        concert: { title: '연말 콘서트' } as Concert,
      } as ConcertSchedule;
      const mockSchedule2 = {
        scheduleId: 'schedule-002',
        concertDate: '2024-12-31',
        concert: { title: '송년 콘서트' } as Concert,
      } as ConcertSchedule;

      mockRedis.zrevrange.mockResolvedValue([
        'schedule-001', '45',
        'schedule-002', '30',
      ]);
      mockConcertRepository.findScheduleWithConcert
        .mockResolvedValueOnce(mockSchedule1)
        .mockResolvedValueOnce(mockSchedule2);

      // when
      const result = await service.getPopularRanking(10);

      // then
      expect(result).toHaveLength(2);
      expect(result[0].concertTitle).toBe('연말 콘서트');
      expect(result[0].score).toBe(45);
      expect(result[1].concertTitle).toBe('송년 콘서트');
      expect(result[1].score).toBe(30);
    });
  });
});
