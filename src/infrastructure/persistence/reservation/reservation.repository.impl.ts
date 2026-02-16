import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ReservationRepository } from '../../../reservation/reservation.repository';
import { Reservation, ReservationStatus } from '../../../reservation/domain/reservation.entity';

@Injectable()
export class ReservationRepositoryImpl implements ReservationRepository {
  constructor(
    @InjectRepository(Reservation)
    private readonly repo: Repository<Reservation>,
  ) {}

  async save(reservation: Reservation): Promise<Reservation> {
    return this.repo.save(reservation);
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    return this.repo.findOne({ where: { reservationId } });
  }

  async findBySeatIdAndStatusHeld(seatId: string): Promise<Reservation | null> {
    return this.repo.findOne({
      where: { seatId, status: ReservationStatus.HELD },
    });
  }

  async updateStatus(reservationId: string, status: string): Promise<void> {
    await this.repo.update(reservationId, { status: status as ReservationStatus });
  }

  async findExpiredHeldReservations(now: Date): Promise<Reservation[]> {
    return this.repo.find({
      where: {
        status: ReservationStatus.HELD,
        expiresAt: LessThanOrEqual(now),
      },
    });
  }
}
