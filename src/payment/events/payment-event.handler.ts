import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PaymentCompletedEvent } from './payment-completed.event';
import { RankingService } from '../../ranking/ranking.service';
import { ConcertRepository } from '../../concert/concert.repository';
import { DataPlatformService } from '../../infrastructure/data-platform/data-platform.service';
import { DI_TOKENS } from '../../common/di-tokens';

@Injectable()
export class PaymentEventHandler {
  private readonly logger = new Logger(PaymentEventHandler.name);

  constructor(
    private readonly rankingService: RankingService,
    @Inject(DI_TOKENS.CONCERT_REPOSITORY)
    private readonly concertRepository: ConcertRepository,
    private readonly dataPlatformService: DataPlatformService,
  ) {}

  @OnEvent(PaymentCompletedEvent.EVENT_NAME)
  async handleRankingUpdate(event: PaymentCompletedEvent): Promise<void> {
    try {
      const scheduleId = await this.concertRepository.findScheduleIdBySeatId(event.seatId);
      if (scheduleId) {
        await this.rankingService.onReservationConfirmed(scheduleId);
      }
    } catch (error) {
      this.logger.error('랭킹 갱신 처리 중 오류', error);
    }
  }

  @OnEvent(PaymentCompletedEvent.EVENT_NAME)
  async handleDataPlatformNotification(event: PaymentCompletedEvent): Promise<void> {
    try {
      await this.dataPlatformService.sendReservationInfo(event);
    } catch (error) {
      this.logger.error('데이터 플랫폼 전송 중 오류', error);
    }
  }
}
