import { Injectable, Inject } from '@nestjs/common';
import { ReservationRepository } from './reservation.repository';
import { ConcertRepository } from '../concert/concert.repository';
import { Reservation } from './domain/reservation.entity';

@Injectable()
export class ReservationService {
  constructor(
    @Inject('ReservationRepository')
    private readonly reservationRepository: ReservationRepository,
    @Inject('ConcertRepository')
    private readonly concertRepository: ConcertRepository,
  ) {}

  async holdSeat(userId: string, scheduleId: string, seatNo: number): Promise<Reservation> {
    throw new Error('Not implemented');
  }
}
