import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConcertRepository } from '../../../concert/concert.repository';
import { ConcertSchedule } from '../../../concert/domain/concert-schedule.entity';
import { Seat } from '../../../concert/domain/seat.entity';

@Injectable()
export class ConcertRepositoryImpl implements ConcertRepository {
  constructor(
    @InjectRepository(ConcertSchedule)
    private readonly scheduleRepo: Repository<ConcertSchedule>,
    @InjectRepository(Seat)
    private readonly seatRepo: Repository<Seat>,
  ) {}

  async findSchedulesByConcertId(concertId: string): Promise<ConcertSchedule[]> {
    return this.scheduleRepo.find({
      where: { concertId },
      order: { concertDate: 'ASC' },
    });
  }

  async findAvailableSeats(scheduleId: string): Promise<Seat[]> {
    return this.seatRepo.find({
      where: { scheduleId },
      order: { seatNo: 'ASC' },
    });
  }

  async findSeatByScheduleAndNo(scheduleId: string, seatNo: number): Promise<Seat | null> {
    return this.seatRepo.findOne({
      where: { scheduleId, seatNo },
    });
  }
}
