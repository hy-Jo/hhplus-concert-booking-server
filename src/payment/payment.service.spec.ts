import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { ReservationRepository } from '../reservation/reservation.repository';
import { PointService } from '../point/point.service';
import { Payment, PaymentStatus } from './domain/payment.entity';
import { Reservation, ReservationStatus } from '../reservation/domain/reservation.entity';

describe('PaymentService (Clean Architecture)', () => {
  let service: PaymentService;
  let mockPaymentRepository: jest.Mocked<PaymentRepository>;
  let mockReservationRepository: jest.Mocked<ReservationRepository>;
  let mockPointService: jest.Mocked<PointService>;

  beforeEach(() => {
    mockPaymentRepository = {
      save: jest.fn(),
      findByReservationId: jest.fn(),
    };

    mockReservationRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findBySeatIdAndStatusHeld: jest.fn(),
      updateStatus: jest.fn(),
      findExpiredHeldReservations: jest.fn(),
    };

    mockPointService = {
      chargePoints: jest.fn(),
      getBalance: jest.fn(),
      usePoints: jest.fn(),
    } as any;

    service = new PaymentService(
      mockPaymentRepository,
      mockReservationRepository,
      mockPointService,
    );
  });

  describe('processPayment', () => {
    it('유효한 HELD 예약에 대해 결제를 성공적으로 처리한다', async () => {
      // given
      const userId = 'user-1';
      const reservationId = 'reservation-1';
      const amount = 50000;

      const reservation: Reservation = {
        reservationId,
        userId,
        seatId: 'seat-1',
        status: ReservationStatus.HELD,
        heldAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 아직 만료 안 됨
        createdAt: new Date(),
      } as Reservation;

      mockReservationRepository.findById.mockResolvedValue(reservation);
      mockPointService.usePoints.mockResolvedValue(undefined);
      mockPaymentRepository.save.mockResolvedValue({
        paymentId: 'payment-1',
        reservationId,
        userId,
        amount,
        status: PaymentStatus.SUCCESS,
        paidAt: expect.any(Date),
        createdAt: expect.any(Date),
      } as Payment);

      // when
      const result = await service.processPayment(userId, reservationId, amount);

      // then
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.amount).toBe(amount);
      expect(mockPointService.usePoints).toHaveBeenCalledWith(userId, amount, expect.any(String));
      expect(mockReservationRepository.updateStatus).toHaveBeenCalledWith(
        reservationId,
        ReservationStatus.CONFIRMED,
      );
    });

    it('만료된 예약에 대해 결제하면 에러를 던진다', async () => {
      // given
      const reservation: Reservation = {
        reservationId: 'reservation-1',
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.HELD,
        heldAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000), // 이미 만료됨
        createdAt: new Date(),
      } as Reservation;

      mockReservationRepository.findById.mockResolvedValue(reservation);

      // when & then
      await expect(
        service.processPayment('user-1', 'reservation-1', 50000),
      ).rejects.toThrow();
    });

    it('존재하지 않는 예약에 대해 결제하면 에러를 던진다', async () => {
      // given
      mockReservationRepository.findById.mockResolvedValue(null);

      // when & then
      await expect(
        service.processPayment('user-1', 'non-existent', 50000),
      ).rejects.toThrow();
    });

    it('이미 CONFIRMED 된 예약에 대해 결제하면 에러를 던진다', async () => {
      // given
      const reservation: Reservation = {
        reservationId: 'reservation-1',
        userId: 'user-1',
        seatId: 'seat-1',
        status: ReservationStatus.CONFIRMED,
        heldAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        createdAt: new Date(),
      } as Reservation;

      mockReservationRepository.findById.mockResolvedValue(reservation);

      // when & then
      await expect(
        service.processPayment('user-1', 'reservation-1', 50000),
      ).rejects.toThrow();
    });

    it('다른 유저의 예약에 대해 결제하면 에러를 던진다', async () => {
      // given
      const reservation: Reservation = {
        reservationId: 'reservation-1',
        userId: 'user-1', // 예약 소유자
        seatId: 'seat-1',
        status: ReservationStatus.HELD,
        heldAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        createdAt: new Date(),
      } as Reservation;

      mockReservationRepository.findById.mockResolvedValue(reservation);

      // when & then - user-2가 user-1의 예약을 결제 시도
      await expect(
        service.processPayment('user-2', 'reservation-1', 50000),
      ).rejects.toThrow();
    });
  });
});
