import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ReservationRepository } from './reservation.repository';
import { ConcertRepository } from '../concert/concert.repository';
import { Reservation, ReservationStatus } from './domain/reservation.entity';

@Injectable()
export class ReservationService {
  private static readonly HOLD_DURATION_MS = 5 * 60 * 1000;

  constructor(
    @Inject('RESERVATION_REPOSITORY')
    private readonly reservationRepository: ReservationRepository,
    @Inject('ConcertRepository')
    private readonly concertRepository: ConcertRepository,
    private readonly dataSource: DataSource,
  ) {}

  async holdSeat(userId: string, scheduleId: string, seatNo: number): Promise<Reservation> {
    const seat = await this.concertRepository.findSeatByScheduleAndNo(scheduleId, seatNo);
    if (!seat) {
      throw new NotFoundException('좌석을 찾을 수 없습니다.');
    }

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(Reservation, {
        where: {
          seatId: seat.seatId,
          status: In([ReservationStatus.HELD, ReservationStatus.CONFIRMED]),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (existing) {
        throw new BadRequestException('이미 임시 배정된 좌석입니다.');
      }

      const now = new Date();
      const reservation = new Reservation();
      reservation.userId = userId;
      reservation.seatId = seat.seatId;
      reservation.status = ReservationStatus.HELD;
      reservation.heldAt = now;
      reservation.expiresAt = new Date(now.getTime() + ReservationService.HOLD_DURATION_MS);

      return manager.save(reservation);
    });
  }
}
