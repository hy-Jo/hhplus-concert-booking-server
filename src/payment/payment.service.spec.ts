import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/domain/reservation.entity';
import { PaymentCompletedEvent } from './events/payment-completed.event';

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
  let mockEventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;

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

    const mockDistributedLockService = {
      withLock: jest.fn((key, callback) => callback()),
    } as any;

    mockEventEmitter = {
      emit: jest.fn(),
    };

    service = new PaymentService(
      mockPaymentRepository,
      mockPointService,
      mockDataSource as DataSource,
      mockDistributedLockService,
      mockEventEmitter as any,
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

    it('결제 성공 후 PaymentCompletedEvent를 발행한다', async () => {
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
          paidAt: new Date(),
        } as Payment)
        .mockResolvedValueOnce(createReservation({ status: ReservationStatus.CONFIRMED }));

      // when
      await service.processPayment(userId, reservationId, amount);

      // then
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PaymentCompletedEvent.EVENT_NAME,
        expect.objectContaining({
          paymentId: 'payment-1',
          userId: 'user-1',
          reservationId: 'reservation-1',
          seatId: 'seat-1',
          amount: 50000,
        }),
      );
    });

    it('결제 실패 시 이벤트를 발행하지 않는다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(null);

      // when & then
      await expect(
        service.processPayment('user-1', 'non-existent', 50000),
      ).rejects.toThrow(NotFoundException);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
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
