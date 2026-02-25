import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { QueueService } from './queue.service';

@Injectable()
export class QueueScheduler {
  private readonly logger = new Logger(QueueScheduler.name);

  constructor(private readonly queueService: QueueService) {}

  /**
   * 5초마다 실행: WAITING 토큰을 ACTIVE로 전환
   * MAX_ACTIVE_TOKENS 한도 내에서 빈 자리만큼 활성화
   */
  @Interval(5_000)
  async activateWaitingTokens(): Promise<void> {
    try {
      await this.queueService.activateTokens();
    } catch (error) {
      this.logger.error('대기열 활성화 처리 중 오류', error);
    }
  }

  /**
   * 30초마다 실행: 만료된 WAITING 토큰 정리
   */
  @Interval(30_000)
  async cleanupExpiredTokens(): Promise<void> {
    try {
      await this.queueService.cleanupExpiredTokens();
    } catch (error) {
      this.logger.error('만료 토큰 정리 중 오류', error);
    }
  }
}
