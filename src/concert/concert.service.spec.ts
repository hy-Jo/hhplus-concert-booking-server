import { ConcertService } from './concert.service';
import { ConcertRepository } from './concert.repository';
import { ConcertSchedule } from './domain/concert-schedule.entity';
import { Seat } from './domain/seat.entity';

describe('ConcertService', () => {
  let service: ConcertService;
  let mockConcertRepository: jest.Mocked<ConcertRepository>;

  beforeEach(() => {
    mockConcertRepository = {
      findSchedulesByConcertId: jest.fn(),
      findAvailableSeats: jest.fn(),
      findSeatByScheduleAndNo: jest.fn(),
      findScheduleWithConcert: jest.fn(),
      findScheduleIdBySeatId: jest.fn(),
    };

    const mockCacheService = {
      getOrLoad: jest.fn((key, loader) => loader()),
    } as any;

    service = new ConcertService(mockConcertRepository, mockCacheService);
  });

  describe('getAvailableSchedules', () => {
    it('콘서트 ID로 예약 가능한 날짜 목록을 조회한다', async () => {
      // given
      const concertId = 'concert-1';
      const schedules: ConcertSchedule[] = [
        {
          scheduleId: 'schedule-1',
          concertId,
          concertDate: '2026-03-01',
          createdAt: new Date(),
        } as ConcertSchedule,
        {
          scheduleId: 'schedule-2',
          concertId,
          concertDate: '2026-03-02',
          createdAt: new Date(),
        } as ConcertSchedule,
      ];
      mockConcertRepository.findSchedulesByConcertId.mockResolvedValue(schedules);

      // when
      const result = await service.getAvailableSchedules(concertId);

      // then
      expect(result).toHaveLength(2);
      expect(result[0].concertDate).toBe('2026-03-01');
      expect(result[1].concertDate).toBe('2026-03-02');
      expect(mockConcertRepository.findSchedulesByConcertId).toHaveBeenCalledWith(concertId);
    });

    it('존재하지 않는 콘서트 ID로 조회하면 빈 배열을 반환한다', async () => {
      // given
      mockConcertRepository.findSchedulesByConcertId.mockResolvedValue([]);

      // when
      const result = await service.getAvailableSchedules('non-existent');

      // then
      expect(result).toHaveLength(0);
    });
  });

  describe('getAvailableSeats', () => {
    it('스케줄 ID로 예약 가능한 좌석 목록을 조회한다', async () => {
      // given
      const scheduleId = 'schedule-1';
      const seats: Seat[] = Array.from({ length: 50 }, (_, i) => ({
        seatId: `seat-${i + 1}`,
        scheduleId,
        seatNo: i + 1,
        createdAt: new Date(),
      })) as Seat[];
      mockConcertRepository.findAvailableSeats.mockResolvedValue(seats);

      // when
      const result = await service.getAvailableSeats(scheduleId);

      // then
      expect(result).toHaveLength(50);
      expect(result[0].seatNo).toBe(1);
      expect(result[49].seatNo).toBe(50);
      expect(mockConcertRepository.findAvailableSeats).toHaveBeenCalledWith(scheduleId);
    });

    it('좌석이 모두 예약된 경우 빈 배열을 반환한다', async () => {
      // given
      mockConcertRepository.findAvailableSeats.mockResolvedValue([]);

      // when
      const result = await service.getAvailableSeats('schedule-full');

      // then
      expect(result).toHaveLength(0);
    });
  });
});
