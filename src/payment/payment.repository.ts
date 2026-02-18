import { Payment } from './domain/payment.entity';

export interface PaymentRepository {
  save(payment: Payment): Promise<Payment>;
  findByReservationId(reservationId: string): Promise<Payment | null>;
}
