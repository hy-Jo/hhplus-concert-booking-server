import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/domain/reservation.entity';

const createReservation = (overrides: Partial<Reservation> = {}): Reservation =>
  ({
    reservationId: 'reservation-1',
    userId: 'user-1',
    seatId: 'seat-1',
    status: ReservationStatus.HELD,
    heldAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  }) as Reservation;

describe('PaymentService (Clean Architecture)', () => {
  let service: PaymentService;
  let mockPaymentRepository: jest.Mocked<PaymentRepository>;
  let mockPointService: jest.Mocked<PointService>;
  let mockManager: { findOne: jest.Mock; save: jest.Mock };
  let mockDataSource: Partial<DataSource>;

  beforeEach(() => {
    mockPaymentRepository = {
      save: jest.fn(),
      findByReservationId: jest.fn(),
    };

    mockPointService = {
      chargePoints: jest.fn(),
      getBalance: jest.fn(),
      usePoints: jest.fn(),
    } as any;

    mockManager = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn((cb: any) => cb(mockManager)),
    };

    const mockConcertRepository = {
      findSchedulesByConcertId: jest.fn(),
      findAvailableSeats: jest.fn(),
      findSeatByScheduleAndNo: jest.fn(),
      findScheduleWithConcert: jest.fn(),
      findScheduleIdBySeatId: jest.fn(),
    } as any;

    const mockRankingService = {
      onReservationConfirmed: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockDistributedLockService = {
      withLock: jest.fn((key, callback) => callback()),
    } as any;

    service = new PaymentService(
      mockPaymentRepository,
      mockConcertRepository,
      mockPointService,
      mockRankingService,
      mockDataSource as DataSource,
      mockDistributedLockService,
    );
  });

  describe('processPayment', () => {
    it('유효한 HELD 예약에 대해 결제를 성공적으로 처리한다', async () => {
      // given
      const userId = 'user-1';
      const reservationId = 'reservation-1';
      const amount = 50000;

      mockManager.findOne.mockResolvedValue(createReservation());
      mockPointService.usePoints.mockResolvedValue(undefined);
      mockManager.save
        .mockResolvedValueOnce({
          paymentId: 'payment-1',
          reservationId,
          userId,
          amount,
          status: PaymentStatus.SUCCESS,
          paidAt: expect.any(Date),
        } as Payment)
        .mockResolvedValueOnce(createReservation({ status: ReservationStatus.CONFIRMED }));

      // when
      const result = await service.processPayment(userId, reservationId, amount);

      // then
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.amount).toBe(amount);
      expect(mockPointService.usePoints).toHaveBeenCalledWith(userId, amount, 'payment-1');
      expect(mockManager.save).toHaveBeenCalledTimes(2);
    });

    it('만료된 예약에 대해 결제하면 BadRequestException을 던진다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(
        createReservation({
          heldAt: new Date(Date.now() - 10 * 60 * 1000),
          expiresAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      );

      // when & then
      await expect(
        service.processPayment('user-1', 'reservation-1', 50000),
      ).rejects.toThrow(BadRequestException);
    });

    it('존재하지 않는 예약에 대해 결제하면 NotFoundException을 던진다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(null);

      // when & then
      await expect(
        service.processPayment('user-1', 'non-existent', 50000),
      ).rejects.toThrow(NotFoundException);
    });

    it('이미 CONFIRMED 된 예약에 대해 결제하면 BadRequestException을 던진다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(
        createReservation({ status: ReservationStatus.CONFIRMED }),
      );

      // when & then
      await expect(
        service.processPayment('user-1', 'reservation-1', 50000),
      ).rejects.toThrow(BadRequestException);
    });

    it('다른 유저의 예약에 대해 결제하면 ForbiddenException을 던진다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(createReservation());

      // when & then
      await expect(
        service.processPayment('user-2', 'reservation-1', 50000),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
