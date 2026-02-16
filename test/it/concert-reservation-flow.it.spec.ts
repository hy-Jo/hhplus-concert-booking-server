import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { QueueService } from '../../src/queue/queue.service';
import { ConcertService } from '../../src/concert/concert.service';
import { ReservationService } from '../../src/reservation/reservation.service';
import { PaymentService } from '../../src/payment/payment.service';
import { PointService } from '../../src/point/point.service';
import { ReservationStatus } from '../../src/reservation/domain/reservation.entity';
import { QueueTokenStatus } from '../../src/queue/domain/queue-token.entity';
import { randomUUID } from 'crypto';

describe('콘서트 예약 통합 테스트', () => {
  let app: INestApplication;
  let queueService: QueueService;
  let concertService: ConcertService;
  let reservationService: ReservationService;
  let paymentService: PaymentService;
  let pointService: PointService;
  let dataSource: DataSource;

  const SCHEDULE_ID = 'schedule-001';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    queueService = moduleRef.get(QueueService);
    concertService = moduleRef.get(ConcertService);
    reservationService = moduleRef.get(ReservationService);
    paymentService = moduleRef.get(PaymentService);
    pointService = moduleRef.get(PointService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('테스트 1: 전체 흐름 (토큰 발급 → 포인트 충전 → 좌석 예약 → 결제)', () => {
    const userId = randomUUID();

    it('토큰을 발급받는다', async () => {
      const token = await queueService.issueToken(userId);

      expect(token).toBeDefined();
      expect(token.userId).toBe(userId);
      expect(token.status).toBe(QueueTokenStatus.WAITING);
      expect(token.queuePosition).toBeGreaterThanOrEqual(1);
    });

    it('포인트를 충전한다', async () => {
      const balance = await pointService.chargePoints(userId, 50000);

      expect(balance.userId).toBe(userId);
      expect(Number(balance.balance)).toBe(50000);
    });

    it('예약 가능한 좌석을 조회한다', async () => {
      const seats = await concertService.getAvailableSeats(SCHEDULE_ID);

      expect(seats.length).toBe(50);
      expect(seats[0].seatNo).toBe(1);
    });

    it('좌석을 예약한다 (HELD 상태)', async () => {
      const reservation = await reservationService.holdSeat(userId, SCHEDULE_ID, 1);

      expect(reservation).toBeDefined();
      expect(reservation.userId).toBe(userId);
      expect(reservation.status).toBe(ReservationStatus.HELD);
      expect(reservation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('결제를 완료한다 (CONFIRMED 상태)', async () => {
      // 예약 조회
      const reservations = await dataSource.query(
        `SELECT * FROM reservation WHERE userId = ? AND status = 'HELD'`,
        [userId],
      );
      const reservationId = reservations[0].reservationId;

      const payment = await paymentService.processPayment(userId, reservationId, 50000);

      expect(payment).toBeDefined();
      expect(payment.userId).toBe(userId);
      expect(payment.status).toBe('SUCCESS');

      // 포인트가 차감되었는지 확인
      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(0);

      // 예약이 CONFIRMED 상태인지 확인
      const confirmed = await dataSource.query(
        `SELECT * FROM reservation WHERE reservationId = ?`,
        [reservationId],
      );
      expect(confirmed[0].status).toBe(ReservationStatus.CONFIRMED);
    });

    it('이미 예약된 좌석은 다시 예약할 수 없다', async () => {
      const anotherUser = randomUUID();

      await expect(
        reservationService.holdSeat(anotherUser, SCHEDULE_ID, 1),
      ).rejects.toThrow();
    });
  });

  describe('테스트 2: 만료 후 좌석 재예약 가능', () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const seatNo = 10;

    it('User A가 좌석을 예약한다', async () => {
      const reservation = await reservationService.holdSeat(userA, SCHEDULE_ID, seatNo);
      expect(reservation.status).toBe(ReservationStatus.HELD);
    });

    it('예약 만료 후 User B가 같은 좌석을 예약할 수 있다', async () => {
      // 만료 처리: expiresAt를 과거로 변경 + status를 EXPIRED로 업데이트
      await dataSource.query(
        `UPDATE reservation SET expiresAt = NOW() - INTERVAL 1 MINUTE, status = 'EXPIRED' WHERE userId = ? AND status = 'HELD'`,
        [userA],
      );

      const reservation = await reservationService.holdSeat(userB, SCHEDULE_ID, seatNo);

      expect(reservation).toBeDefined();
      expect(reservation.userId).toBe(userB);
      expect(reservation.status).toBe(ReservationStatus.HELD);
    });
  });

  describe('테스트 3: 동시성 - 다중 유저가 동시에 같은 좌석 요청', () => {
    const seatNo = 30;

    it('10명이 동시에 같은 좌석을 요청하면 1명만 성공한다', async () => {
      const users = Array.from({ length: 10 }, () => randomUUID());

      const results = await Promise.allSettled(
        users.map((userId) =>
          reservationService.holdSeat(userId, SCHEDULE_ID, seatNo),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(9);

      // DB에 HELD 상태 예약이 정확히 1건인지 확인
      const heldReservations = await dataSource.query(
        `SELECT COUNT(*) as cnt FROM reservation WHERE seatId = (SELECT seatId FROM seat WHERE scheduleId = ? AND seatNo = ?) AND status = 'HELD'`,
        [SCHEDULE_ID, seatNo],
      );
      expect(Number(heldReservations[0].cnt)).toBe(1);
    });
  });
});
