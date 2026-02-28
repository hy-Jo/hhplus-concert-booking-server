import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ReservationRepository } from './reservation.repository';
import { ConcertRepository } from '../concert/concert.repository';
import { Reservation, ReservationStatus } from './domain/reservation.entity';
import { DI_TOKENS } from '../common/di-tokens';
import { DistributedLockService } from '../infrastructure/distributed-lock/distributed-lock.service';
import { KafkaProducerService } from '../infrastructure/kafka/kafka.producer.service';

@Injectable()
export class ReservationService {
  private static readonly HOLD_DURATION_MS = 5 * 60 * 1000;

  constructor(
    @Inject(DI_TOKENS.RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(DI_TOKENS.CONCERT_REPOSITORY)
    private readonly concertRepository: ConcertRepository,
    private readonly dataSource: DataSource,
    private readonly distributedLockService: DistributedLockService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async holdSeat(userId: string, scheduleId: string, seatNo: number): Promise<Reservation> {
    const seat = await this.concertRepository.findSeatByScheduleAndNo(scheduleId, seatNo);
    if (!seat) {
      throw new NotFoundException('좌석을 찾을 수 없습니다.');
    }

    // 분산락: 같은 좌석에 대한 동시 예약 방지
    // 키: seat:{seatId} — 좌석 단위로 락을 걸어 최소한의 범위로 동시성 제어
    const reservation = await this.distributedLockService.withLock(
      `seat:${seat.seatId}`,
      async () => {
        return this.dataSource.transaction(async (manager) => {
          const existing = await manager.findOne(Reservation, {
            where: {
              seatId: seat.seatId,
              status: In([ReservationStatus.HELD, ReservationStatus.CONFIRMED]),
            },
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
      },
    );

    // 트랜잭션 완료 후 Kafka 이벤트 발행 (예약 만료 처리)
    await this.kafkaProducer.sendReservationExpirationEvent({
      reservationId: reservation.reservationId,
      userId: reservation.userId,
      seatId: reservation.seatId,
      expiresAt: reservation.expiresAt,
    });

    return reservation;
  }

  /**
   * 예약을 만료 처리합니다 (Kafka Consumer에서 호출)
   * 조건부 UPDATE로 멱등성 보장: HELD 상태인 경우만 EXPIRED로 변경
   */
  async expireReservation(reservationId: string): Promise<boolean> {
    const result = await this.dataSource.query(
      `UPDATE reservation SET status = ? WHERE reservationId = ? AND status = ?`,
      [ReservationStatus.EXPIRED, reservationId, ReservationStatus.HELD],
    );

    return result.affectedRows > 0;
  }
}
