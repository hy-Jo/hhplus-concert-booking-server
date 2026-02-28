import { PaymentEventHandler } from './payment-event.handler';
import { PaymentCompletedEvent } from './payment-completed.event';
import { RankingService } from '../../ranking/ranking.service';
import { ConcertRepository } from '../../concert/concert.repository';
import { DataPlatformService } from '../../infrastructure/data-platform/data-platform.service';

describe('PaymentEventHandler', () => {
  let handler: PaymentEventHandler;
  let mockRankingService: jest.Mocked<Pick<RankingService, 'onReservationConfirmed'>>;
  let mockConcertRepository: jest.Mocked<Pick<ConcertRepository, 'findScheduleIdBySeatId'>>;
  let mockDataPlatformService: jest.Mocked<DataPlatformService>;

  const event = new PaymentCompletedEvent('payment-1', 'user-1', 'reservation-1', 'seat-1', 50000);

  beforeEach(() => {
    mockRankingService = {
      onReservationConfirmed: jest.fn().mockResolvedValue(undefined),
    };

    mockConcertRepository = {
      findScheduleIdBySeatId: jest.fn().mockResolvedValue('schedule-1'),
    };

    mockDataPlatformService = {
      sendReservationInfo: jest.fn().mockResolvedValue(undefined),
    } as any;

    handler = new PaymentEventHandler(
      mockRankingService as any,
      mockConcertRepository as any,
      mockDataPlatformService,
    );
  });

  describe('handleRankingUpdate', () => {
    it('seatId로 scheduleId를 조회하여 랭킹을 갱신한다', async () => {
      // when
      await handler.handleRankingUpdate(event);

      // then
      expect(mockConcertRepository.findScheduleIdBySeatId).toHaveBeenCalledWith('seat-1');
      expect(mockRankingService.onReservationConfirmed).toHaveBeenCalledWith('schedule-1');
    });

    it('scheduleId가 없으면 랭킹을 갱신하지 않는다', async () => {
      // given
      mockConcertRepository.findScheduleIdBySeatId.mockResolvedValue(null);

      // when
      await handler.handleRankingUpdate(event);

      // then
      expect(mockRankingService.onReservationConfirmed).not.toHaveBeenCalled();
    });

    it('랭킹 갱신 중 오류가 발생해도 예외를 던지지 않는다', async () => {
      // given
      mockRankingService.onReservationConfirmed.mockRejectedValue(new Error('Redis error'));

      // when & then
      await expect(handler.handleRankingUpdate(event)).resolves.not.toThrow();
    });
  });

  describe('handleDataPlatformNotification', () => {
    it('데이터 플랫폼에 예약 정보를 전송한다', async () => {
      // when
      await handler.handleDataPlatformNotification(event);

      // then
      expect(mockDataPlatformService.sendReservationInfo).toHaveBeenCalledWith(event);
    });

    it('데이터 플랫폼 전송 중 오류가 발생해도 예외를 던지지 않는다', async () => {
      // given
      mockDataPlatformService.sendReservationInfo.mockRejectedValue(new Error('API error'));

      // when & then
      await expect(handler.handleDataPlatformNotification(event)).resolves.not.toThrow();
    });
  });
});
