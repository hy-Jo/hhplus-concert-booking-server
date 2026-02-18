import { Injectable, Inject } from '@nestjs/common';
import { ConcertRepository } from './concert.repository';
import { ConcertSchedule } from './domain/concert-schedule.entity';
import { Seat } from './domain/seat.entity';

@Injectable()
export class ConcertService {
  constructor(
    @Inject('ConcertRepository')
    private readonly concertRepository: ConcertRepository,
  ) {}

  async getAvailableSchedules(concertId: string): Promise<ConcertSchedule[]> {
    return this.concertRepository.findSchedulesByConcertId(concertId);
  }

  async getAvailableSeats(scheduleId: string): Promise<Seat[]> {
    return this.concertRepository.findAvailableSeats(scheduleId);
  }
}
