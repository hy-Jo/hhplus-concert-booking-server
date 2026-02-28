import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentRepository } from './payment.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/domain/reservation.entity';
import { DI_TOKENS } from '../common/di-tokens';
import { DistributedLockService } from '../infrastructure/distributed-lock/distributed-lock.service';
import { PaymentCompletedEvent } from './events/payment-completed.event';
import { KafkaProducerService } from '../infrastructure/kafka/kafka.producer.service';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DI_TOKENS.PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    private readonly pointService: PointService,
    private readonly dataSource: DataSource,
    private readonly distributedLockService: DistributedLockService,
    private readonly eventEmitter: EventEmitter2,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async processPayment(userId: string, reservationId: string, amount: number): Promise<Payment> {
    // 분산락: 같은 예약에 대한 중복 결제 방지
    // 키: reservation:{reservationId} — 예약 단위로 락을 걸어 동일 예약의 동시 결제 차단
    const { payment, seatId } = await this.distributedLockService.withLock(
      `reservation:${reservationId}`,
      async () => {
        return this.dataSource.transaction(async (manager) => {
          const reservation = await manager.findOne(Reservation, {
            where: { reservationId },
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

          const newPayment = new Payment();
          newPayment.reservationId = reservationId;
          newPayment.userId = userId;
          newPayment.amount = amount;
          newPayment.status = PaymentStatus.SUCCESS;
          newPayment.paidAt = new Date();

          const saved = await manager.save(newPayment);

          await this.pointService.usePoints(userId, amount, saved.paymentId);

          reservation.status = ReservationStatus.CONFIRMED;
          await manager.save(reservation);

          return { payment: saved, seatId: reservation.seatId };
        });
      },
    );

    // 트랜잭션 완료 후 이벤트 발행 — 관심사 분리
    // Kafka를 통해 이벤트 발행 (EventEmitter → Kafka 전환)
    await this.kafkaProducer.sendPaymentCompletedEvent({
      paymentId: payment.paymentId,
      userId,
      reservationId,
      seatId,
      amount,
    });

    // 기존 EventEmitter는 당분간 유지 (하위 호환성)
    this.eventEmitter.emit(
      PaymentCompletedEvent.EVENT_NAME,
      new PaymentCompletedEvent(payment.paymentId, userId, reservationId, seatId, amount),
    );

    return payment;
  }
}
