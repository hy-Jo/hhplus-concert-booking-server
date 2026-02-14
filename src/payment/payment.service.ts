import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PaymentRepository } from './payment.repository';
import { ReservationRepository } from '../reservation/reservation.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { ReservationStatus } from '../reservation/domain/reservation.entity';

@Injectable()
export class PaymentService {
  constructor(
    @Inject('PaymentRepository')
    private readonly paymentRepository: PaymentRepository,
    @Inject('ReservationRepository')
    private readonly reservationRepository: ReservationRepository,
    private readonly pointService: PointService,
  ) {}

  async processPayment(userId: string, reservationId: string, amount: number): Promise<Payment> {
    const reservation = await this.reservationRepository.findById(reservationId);
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

    const saved = await this.paymentRepository.save(payment);

    await this.pointService.usePoints(userId, amount, saved.paymentId);
    await this.reservationRepository.updateStatus(reservationId, ReservationStatus.CONFIRMED);

    return saved;
  }
}
