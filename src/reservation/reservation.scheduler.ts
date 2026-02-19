import { Injectable, Inject, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ReservationRepository } from './reservation.repository';
import { ReservationStatus } from './domain/reservation.entity';
import { DI_TOKENS } from '../common/di-tokens';

@Injectable()
export class ReservationScheduler {
  private readonly logger = new Logger(ReservationScheduler.name);

  constructor(
    @Inject(DI_TOKENS.RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    private readonly dataSource: DataSource,
  ) {}

  @Interval(10_000)
  async expireHeldReservations(): Promise<void> {
    const expired = await this.reservationRepository.findExpiredHeldReservations(new Date());

    if (expired.length === 0) return;

    this.logger.log(`만료 대상 예약 ${expired.length}건 발견`);

    for (const reservation of expired) {
      // 조건부 UPDATE: 이미 CONFIRMED로 바뀐 예약은 건드리지 않음
      const result = await this.dataSource.query(
        `UPDATE reservation SET status = ? WHERE reservationId = ? AND status = ?`,
        [ReservationStatus.EXPIRED, reservation.reservationId, ReservationStatus.HELD],
      );

      if (result.affectedRows > 0) {
        this.logger.log(`예약 ${reservation.reservationId} 만료 처리 완료`);
      }
    }
  }
}
