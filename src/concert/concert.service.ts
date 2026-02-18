import { Injectable, Inject } from '@nestjs/common';
import { ConcertRepository } from './concert.repository';
import { ConcertSchedule } from './domain/concert-schedule.entity';
import { Seat } from './domain/seat.entity';
import { DI_TOKENS } from '../common/di-tokens';

@Injectable()
export class ConcertService {
  constructor(
    @Inject(DI_TOKENS.CONCERT_REPOSITORY)
    private readonly concertRepository: ConcertRepository,
  ) {}

  async getAvailableSchedules(concertId: string): Promise<ConcertSchedule[]> {
    return this.concertRepository.findSchedulesByConcertId(concertId);
  }

  async getAvailableSeats(scheduleId: string): Promise<Seat[]> {
    return this.concertRepository.findAvailableSeats(scheduleId);
  }
}
