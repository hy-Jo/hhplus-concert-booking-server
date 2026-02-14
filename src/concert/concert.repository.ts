import { Concert } from './domain/concert.entity';
import { ConcertSchedule } from './domain/concert-schedule.entity';
import { Seat } from './domain/seat.entity';

export interface ConcertRepository {
  findSchedulesByConcertId(concertId: string): Promise<ConcertSchedule[]>;
  findAvailableSeats(scheduleId: string): Promise<Seat[]>;
  findSeatByScheduleAndNo(scheduleId: string, seatNo: number): Promise<Seat | null>;
}
