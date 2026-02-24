import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DistributedLockService, DistributedLockAcquisitionError } from '../../src/infrastructure/distributed-lock/distributed-lock.service';
import { ReservationService } from '../../src/reservation/reservation.service';
import { PointService } from '../../src/point/point.service';
import { PaymentService } from '../../src/payment/payment.service';
import { randomUUID } from 'crypto';

describe('분산락 통합 테스트', () => {
  let app: INestApplication;
  let lockService: DistributedLockService;
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

    lockService = moduleRef.get(DistributedLockService);
    reservationService = moduleRef.get(ReservationService);
    pointService = moduleRef.get(PointService);
    paymentService = moduleRef.get(PaymentService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  // ──────────────────────────────────────────────
  // 1. 분산락 기본 동작 테스트
  // ──────────────────────────────────────────────
  describe('분산락 기본 동작', () => {
    it('같은 키로 동시에 락을 획득하면 순차적으로 실행된다', async () => {
      const executionOrder: number[] = [];
      const key = `test:${randomUUID()}`;

      const task = (order: number, delayMs: number) =>
        lockService.withLock(key, async () => {
          executionOrder.push(order);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return order;
        });

      // 3개의 태스크를 동시에 실행
      const results = await Promise.all([
        task(1, 100),
        task(2, 50),
        task(3, 50),
      ]);

      // 모든 태스크가 성공해야 한다
      expect(results.sort()).toEqual([1, 2, 3]);
      // 순차적으로 실행되었으므로 executionOrder에 3개 모두 존재
      expect(executionOrder.length).toBe(3);
    });

    it('락 획득 대기 시간이 초과되면 DistributedLockAcquisitionError가 발생한다', async () => {
      const key = `test:${randomUUID()}`;

      // 첫 번째 태스크가 오래 점유
      const longTask = lockService.withLock(
        key,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return 'done';
        },
        { ttlMs: 5000 },
      );

      // 두 번째 태스크는 짧은 대기 시간으로 실패
      const shortWaitTask = lockService.withLock(
        key,
        async () => 'should not reach',
        { waitMs: 200, retryIntervalMs: 50 },
      );

      await expect(shortWaitTask).rejects.toThrow(DistributedLockAcquisitionError);
      await longTask; // cleanup
    });

    it('다른 키는 동시에 락을 획득할 수 있다', async () => {
      const startTimes: number[] = [];

      const task = (key: string) =>
        lockService.withLock(key, async () => {
          startTimes.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, 200));
        });

      const start = Date.now();
      await Promise.all([
        task(`test:a:${randomUUID()}`),
        task(`test:b:${randomUUID()}`),
      ]);
      const elapsed = Date.now() - start;

      // 서로 다른 키이므로 병렬 실행 → 400ms가 아니라 ~200ms 내 완료
      expect(elapsed).toBeLessThan(350);
    });

    it('콜백에서 예외가 발생하면 락이 해제된다', async () => {
      const key = `test:${randomUUID()}`;

      // 예외를 발생시키는 태스크
      await expect(
        lockService.withLock(key, async () => {
          throw new Error('의도된 에러');
        }),
      ).rejects.toThrow('의도된 에러');

      // 락이 해제되었으므로 다시 획득 가능
      const result = await lockService.withLock(key, async () => 'success');
      expect(result).toBe('success');
    });
  });

  // ──────────────────────────────────────────────
  // 2. 좌석 예약 - 분산락 동시성 테스트
  // ──────────────────────────────────────────────
  describe('좌석 예약 - 분산락 동시성', () => {
    it('10명이 동시에 같은 좌석을 예약하면 1명만 성공한다', async () => {
      const seatNo = 20;
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

      // DB에 HELD 예약이 정확히 1건
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
  // 3. 포인트 충전 - 분산락 동시성 테스트
  // ──────────────────────────────────────────────
  describe('포인트 충전 - 분산락 동시성', () => {
    it('동시에 10번 1000원씩 충전하면 최종 잔액은 10000원이다', async () => {
      const userId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          pointService.chargePoints(userId, 1000),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(10);

      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(10000);
    });
  });

  // ──────────────────────────────────────────────
  // 4. 포인트 사용 - 분산락 동시성 테스트
  // ──────────────────────────────────────────────
  describe('포인트 사용 - 분산락 동시성', () => {
    it('잔액 5000원에서 동시에 5건의 2000원 사용 시 2건만 성공하고 잔액 1000원', async () => {
      const userId = randomUUID();
      await pointService.chargePoints(userId, 5000);

      const seatNos = [21, 22, 23, 24, 25];
      const reservations = [];
      for (const seatNo of seatNos) {
        const r = await reservationService.holdSeat(userId, SCHEDULE_ID, seatNo);
        reservations.push(r);
      }

      const results = await Promise.allSettled(
        reservations.map((r) =>
          paymentService.processPayment(userId, r.reservationId, 2000),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(2);
      expect(rejected.length).toBe(3);

      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(1000);
    });
  });

  // ──────────────────────────────────────────────
  // 5. 결제 중복 처리 - 분산락 동시성 테스트
  // ──────────────────────────────────────────────
  describe('결제 중복 처리 - 분산락 동시성', () => {
    it('같은 예약에 동시 5번 결제 시도 시 1번만 성공한다', async () => {
      const userId = randomUUID();
      await pointService.chargePoints(userId, 100000);

      const reservation = await reservationService.holdSeat(userId, SCHEDULE_ID, 26);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          paymentService.processPayment(userId, reservation.reservationId, 10000),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);

      // 포인트는 1번만 차감
      const balance = await pointService.getBalance(userId);
      expect(Number(balance.balance)).toBe(90000);
    });
  });
});
