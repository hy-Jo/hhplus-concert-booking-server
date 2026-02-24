import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentRepository } from './payment.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/domain/reservation.entity';
import { DI_TOKENS } from '../common/di-tokens';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DI_TOKENS.PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    private readonly pointService: PointService,
    private readonly dataSource: DataSource,
  ) {}

  async processPayment(userId: string, reservationId: string, amount: number): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      // 비관적 락으로 예약 조회 — 스케줄러와의 Race Condition 방지
      const reservation = await manager.findOne(Reservation, {
        where: { reservationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!reservation) {
        throw new NotFoundException('예약을 찾을 수 없습니다.');
      }
      if (reservation.userId !== userId) {
        throw new ForbiddenException('본인의 예약만 결제할 수 있습니다.');
      }
      if (reservation.status !== ReservationStatus.HELD) {
        throw new BadRequestException('HELD 상태의 예약만 결제할 수 있습니다.');
      }
      if (new Date() > reservation.expiresAt) {
        throw new BadRequestException('예약이 만료되었습니다.');
      }

      const payment = new Payment();
      payment.reservationId = reservationId;
      payment.userId = userId;
      payment.amount = amount;
      payment.status = PaymentStatus.SUCCESS;
      payment.paidAt = new Date();

      const saved = await manager.save(payment);

      await this.pointService.usePoints(userId, amount, saved.paymentId);

      reservation.status = ReservationStatus.CONFIRMED;
      await manager.save(reservation);

      return saved;
    });
  }
}
