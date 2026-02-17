import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { ReservationService } from '../../src/reservation/reservation.service';
import { PointService } from '../../src/point/point.service';
import { PaymentService } from '../../src/payment/payment.service';
import { randomUUID } from 'crypto';

describe('동시성 테스트', () => {
  let app: INestApplication;
  let reservationService: ReservationService;
  let pointService: PointService;
  let paymentService: PaymentService;
  let dataSource: DataSource;

  const SCHEDULE_ID = 'schedule-001';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    reservationService = moduleRef.get(ReservationService);
    pointService = moduleRef.get(PointService);
    paymentService = moduleRef.get(PaymentService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  // ──────────────────────────────────────────────
  // 1. 좌석 예약 동시성
  // ──────────────────────────────────────────────
  describe('좌석 예약 동시성', () => {
    it('10명이 동시에 같은 좌석을 예약하면 1명만 성공한다', async () => {
      const seatNo = 40;
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

      // DB에도 HELD 예약이 정확히 1건인지 확인
      const rows = await dataSource.query(
        `SELECT COUNT(*) as cnt FROM reservation
         WHERE seatId = (SELECT seatId FROM seat WHERE scheduleId = ? AND seatNo = ?)
         AND status = 'HELD'`,
        [SCHEDULE_ID, seatNo],
      );
      expect(Number(rows[0].cnt)).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // 2. 포인트 충전 동시성
  // ──────────────────────────────────────────────
  describe('포인트 충전 동시성', () => {
    it('같은 유저가 동시에 10번 1000원씩 충전하면 최종 잔액은 10000원이어야 한다', async () => {
      const userId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          pointService.chargePoints(userId, 1000),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      // 모든 충전이 성공해야 한다
      expect(fulfilled.length).toBe(10);

      // 최종 잔액이 정확히 10000원이어야 한다 (Lost Update가 없어야 함)
      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(10000);
    });
  });

  // ──────────────────────────────────────────────
  // 3. 포인트 사용 동시성
  // ──────────────────────────────────────────────
  describe('포인트 사용 동시성', () => {
    it('잔액 5000원인 유저가 동시에 5건의 2000원 결제를 시도하면, 2건만 성공하고 잔액은 1000원이어야 한다', async () => {
      const userId = randomUUID();

      // 사전 충전: 5000원
      await pointService.chargePoints(userId, 5000);

      // 5건의 예약을 미리 생성 (각각 다른 좌석)
      const seatNos = [41, 42, 43, 44, 45];
      const reservations = [];
      for (const seatNo of seatNos) {
        const r = await reservationService.holdSeat(userId, SCHEDULE_ID, seatNo);
        reservations.push(r);
      }

      // 동시에 5건의 결제 시도 (각 2000원)
      const results = await Promise.allSettled(
        reservations.map((r) =>
          paymentService.processPayment(userId, r.reservationId, 2000),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // 5000원으로 2000원짜리 최대 2건만 결제 가능
      expect(fulfilled.length).toBe(2);
      expect(rejected.length).toBe(3);

      // 잔액이 음수가 되면 안 된다
      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(1000);
    });
  });

  // ──────────────────────────────────────────────
  // 4. 결제 중복 처리 동시성
  // ──────────────────────────────────────────────
  describe('결제 중복 처리 동시성', () => {
    it('같은 예약에 대해 동시에 5번 결제를 시도하면 1번만 성공한다', async () => {
      const userId = randomUUID();

      // 사전 충전: 100000원
      await pointService.chargePoints(userId, 100000);

      // 좌석 예약
      const reservation = await reservationService.holdSeat(userId, SCHEDULE_ID, 46);

      // 동시에 5번 결제 시도
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          paymentService.processPayment(userId, reservation.reservationId, 10000),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // 결제는 1번만 성공해야 한다
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // 포인트는 1번만 차감되어야 한다 (100000 - 10000 = 90000)
      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(90000);
    });
  });
});
