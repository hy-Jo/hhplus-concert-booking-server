import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationRepository } from './reservation.repository';
import { ConcertRepository } from '../concert/concert.repository';
import { Reservation, ReservationStatus } from './domain/reservation.entity';

@Injectable()
export class ReservationService {
  private static readonly HOLD_DURATION_MS = 5 * 60 * 1000;

  constructor(
    @Inject('ReservationRepository')
    private readonly reservationRepository: ReservationRepository,
    @Inject('ConcertRepository')
    private readonly concertRepository: ConcertRepository,
  ) {}

  async holdSeat(userId: string, scheduleId: string, seatNo: number): Promise<Reservation> {
    const seat = await this.concertRepository.findSeatByScheduleAndNo(scheduleId, seatNo);
    if (!seat) {
      throw new NotFoundException('좌석을 찾을 수 없습니다.');
    }

    const existingHold = await this.reservationRepository.findBySeatIdAndStatusHeld(seat.seatId);
    if (existingHold) {
      throw new BadRequestException('이미 임시 배정된 좌석입니다.');
    }

    const now = new Date();
    const reservation = new Reservation();
    reservation.userId = userId;
    reservation.seatId = seat.seatId;
    reservation.status = ReservationStatus.HELD;
    reservation.heldAt = now;
    reservation.expiresAt = new Date(now.getTime() + ReservationService.HOLD_DURATION_MS);

    return this.reservationRepository.save(reservation);
  }
}
