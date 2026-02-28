import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentRepository } from './payment.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/domain/reservation.entity';
import { DI_TOKENS } from '../common/di-tokens';
import { DistributedLockService } from '../infrastructure/distributed-lock/distributed-lock.service';
import { RankingService } from '../ranking/ranking.service';
import { ConcertRepository } from '../concert/concert.repository';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DI_TOKENS.PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(DI_TOKENS.CONCERT_REPOSITORY)
    private readonly concertRepository: ConcertRepository,
    private readonly pointService: PointService,
    private readonly rankingService: RankingService,
    private readonly dataSource: DataSource,
    private readonly distributedLockService: DistributedLockService,
  ) {}

  async processPayment(userId: string, reservationId: string, amount: number): Promise<Payment> {
    // 분산락: 같은 예약에 대한 중복 결제 방지
    // 키: reservation:{reservationId} — 예약 단위로 락을 걸어 동일 예약의 동시 결제 차단
    return this.distributedLockService.withLock(
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

          // 랭킹 갱신 (트랜잭션 외부에서 비동기 처리 — 실패해도 결제에 영향 없음)
          this.updateRanking(reservation.seatId).catch(() => {});

          return saved;
        });
      },
    );
  }

  private async updateRanking(seatId: string): Promise<void> {
    const scheduleId = await this.concertRepository.findScheduleIdBySeatId(seatId);
    if (scheduleId) {
      await this.rankingService.onReservationConfirmed(scheduleId);
    }
  }
}
