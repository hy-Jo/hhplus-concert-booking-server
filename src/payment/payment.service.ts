import { Injectable, Inject } from '@nestjs/common';
import { PaymentRepository } from './payment.repository';
import { ReservationRepository } from '../reservation/reservation.repository';
import { PointService } from '../point/point.service';
import { Payment } from './domain/payment.entity';

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
    throw new Error('Not implemented');
  }
}
