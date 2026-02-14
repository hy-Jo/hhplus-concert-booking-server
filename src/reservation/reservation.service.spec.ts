import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ReservationRepository } from './reservation.repository';
import { ConcertRepository } from '../concert/concert.repository';
import { Reservation, ReservationStatus } from './domain/reservation.entity';
import { Seat } from '../concert/domain/seat.entity';

const createSeat = (overrides: Partial<Seat> = {}): Seat =>
  ({
    seatId: 'seat-10',
    scheduleId: 'schedule-1',
    seatNo: 10,
    createdAt: new Date(),
    ...overrides,
  }) as Seat;

describe('ReservationService (Clean Architecture)', () => {
  let service: ReservationService;
  let mockReservationRepository: jest.Mocked<ReservationRepository>;
  let mockConcertRepository: jest.Mocked<ConcertRepository>;

  beforeEach(() => {
    mockReservationRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findBySeatIdAndStatusHeld: jest.fn(),
      updateStatus: jest.fn(),
      findExpiredHeldReservations: jest.fn(),
    };

    mockConcertRepository = {
      findSchedulesByConcertId: jest.fn(),
      findAvailableSeats: jest.fn(),
      findSeatByScheduleAndNo: jest.fn(),
    };

    service = new ReservationService(mockReservationRepository, mockConcertRepository);
  });

  describe('holdSeat', () => {
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    it('좌석을 임시 배정(HELD)하고 5분 만료시간을 설정한다', async () => {
      // given
      const seat = createSeat();
      mockConcertRepository.findSeatByScheduleAndNo.mockResolvedValue(seat);
      mockReservationRepository.findBySeatIdAndStatusHeld.mockResolvedValue(null);
      mockReservationRepository.save.mockResolvedValue({
        reservationId: 'reservation-1',
        userId: 'user-1',
        seatId: seat.seatId,
        status: ReservationStatus.HELD,
        heldAt: expect.any(Date),
        expiresAt: expect.any(Date),
        createdAt: expect.any(Date),
      } as Reservation);

      // when
      const result = await service.holdSeat('user-1', 'schedule-1', 10);

      // then
      expect(result.status).toBe(ReservationStatus.HELD);
      expect(result.userId).toBe('user-1');
      expect(result.seatId).toBe('seat-10');
      expect(mockReservationRepository.save).toHaveBeenCalled();

      const savedArg = mockReservationRepository.save.mock.calls[0][0];
      const diffMs = savedArg.expiresAt.getTime() - savedArg.heldAt.getTime();
      expect(diffMs).toBe(FIVE_MINUTES_MS);
    });

    it('이미 HELD 상태인 좌석을 예약하려고 하면 BadRequestException을 던진다', async () => {
      // given
      const seat = createSeat();
      const existingReservation = {
        reservationId: 'reservation-existing',
        userId: 'other-user',
        seatId: seat.seatId,
        status: ReservationStatus.HELD,
        heldAt: new Date(),
        expiresAt: new Date(Date.now() + FIVE_MINUTES_MS),
        createdAt: new Date(),
      } as Reservation;

      mockConcertRepository.findSeatByScheduleAndNo.mockResolvedValue(seat);
      mockReservationRepository.findBySeatIdAndStatusHeld.mockResolvedValue(existingReservation);

      // when & then
      await expect(
        service.holdSeat('user-2', 'schedule-1', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('존재하지 않는 좌석을 예약하려고 하면 NotFoundException을 던진다', async () => {
      // given
      mockConcertRepository.findSeatByScheduleAndNo.mockResolvedValue(null);

      // when & then
      await expect(
        service.holdSeat('user-1', 'schedule-1', 99),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
