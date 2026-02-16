import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentRepository } from '../../../payment/payment.repository';
import { Payment } from '../../../payment/domain/payment.entity';

@Injectable()
export class PaymentRepositoryImpl implements PaymentRepository {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
  ) {}

  async save(payment: Payment): Promise<Payment> {
    return this.repo.save(payment);
  }

  async findByReservationId(reservationId: string): Promise<Payment | null> {
    return this.repo.findOne({ where: { reservationId } });
  }
}
