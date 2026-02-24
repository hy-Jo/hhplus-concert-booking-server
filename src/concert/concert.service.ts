import { Injectable, Inject } from '@nestjs/common';
import { ConcertRepository } from './concert.repository';
import { ConcertSchedule } from './domain/concert-schedule.entity';
import { Seat } from './domain/seat.entity';
import { DI_TOKENS } from '../common/di-tokens';
import { CacheService } from '../infrastructure/cache/cache.service';

@Injectable()
export class ConcertService {
  // 콘서트 일정: 관리자만 변경하므로 긴 TTL
  private static readonly SCHEDULE_CACHE_TTL_MS = 10 * 60 * 1000; // 10분
  // 좌석 마스터: 불변 데이터이므로 매우 긴 TTL
  private static readonly SEAT_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간
  constructor(
    @Inject(DI_TOKENS.CONCERT_REPOSITORY)
    private readonly concertRepository: ConcertRepository,
    private readonly cacheService: CacheService,
  ) {}

  async getAvailableSchedules(concertId: string): Promise<ConcertSchedule[]> {
    return this.cacheService.getOrLoad(
      `schedule:${concertId}`,
      () => this.concertRepository.findSchedulesByConcertId(concertId),
      ConcertService.SCHEDULE_CACHE_TTL_MS,
    );
  }

  async getAvailableSeats(scheduleId: string): Promise<Seat[]> {
    return this.cacheService.getOrLoad(
      `seats:${scheduleId}`,
      () => this.concertRepository.findAvailableSeats(scheduleId),
      ConcertService.SEAT_LIST_CACHE_TTL_MS,
    );
  }
}
