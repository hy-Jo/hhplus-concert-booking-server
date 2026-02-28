import { Injectable, Inject, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { QueueRepository } from './queue.repository';
import { QueueToken, QueueTokenStatus } from './domain/queue-token.entity';
import { randomUUID } from 'crypto';
import { DI_TOKENS } from '../common/di-tokens';

@Injectable()
export class QueueService {
  private static readonly TOKEN_TTL_MS = 10 * 60 * 1000;
  /** 동시에 ACTIVE 상태일 수 있는 최대 토큰 수 */
  private static readonly MAX_ACTIVE_TOKENS = 50;

  private readonly logger = new Logger(QueueService.name);

  constructor(
    @Inject(DI_TOKENS.QUEUE_REPOSITORY)
    private readonly queueRepository: QueueRepository,
  ) {}

  async issueToken(userId: string): Promise<QueueToken> {
    const existing = await this.queueRepository.findByUserId(userId);
    if (existing && !existing.isExpired()) {
      return existing;
    }

    const waitingCount = await this.queueRepository.countWaiting();

    const token = new QueueToken();
    token.userId = userId;
    token.tokenValue = randomUUID();
    token.queuePosition = waitingCount + 1;
    token.status = QueueTokenStatus.WAITING;
    token.issuedAt = new Date();
    token.expiresAt = new Date(Date.now() + QueueService.TOKEN_TTL_MS);

    return this.queueRepository.save(token);
  }

  async validateToken(tokenValue: string): Promise<QueueToken> {
    const token = await this.findTokenOrThrow(tokenValue);

    if (token.isExpired()) {
      throw new ForbiddenException('토큰이 만료되었습니다.');
    }

    if (!token.isActive()) {
      throw new ForbiddenException('아직 대기 중인 토큰입니다.');
    }

    return token;
  }

  async getQueueStatus(tokenValue: string): Promise<{ position: number; status: string }> {
    const token = await this.findTokenOrThrow(tokenValue);

    return {
      position: token.status === QueueTokenStatus.ACTIVE ? 0 : token.queuePosition,
      status: token.status,
    };
  }

  /**
   * 스케줄러에서 주기적으로 호출: WAITING → ACTIVE 자동 전환
   * 현재 ACTIVE 수가 MAX_ACTIVE_TOKENS 미만이면 빈 자리만큼 WAITING 토큰을 활성화
   */
  async activateTokens(): Promise<number> {
    const activeCount = await this.queueRepository.countActive();
    const slotsAvailable = QueueService.MAX_ACTIVE_TOKENS - activeCount;

    if (slotsAvailable <= 0) {
      return 0;
    }

    const activated = await this.queueRepository.activateNextTokens(slotsAvailable);
    if (activated > 0) {
      this.logger.log(`대기열 토큰 ${activated}건 활성화 (WAITING → ACTIVE)`);
    }
    return activated;
  }

  /**
   * 스케줄러에서 주기적으로 호출: 만료된 WAITING 토큰 정리
   */
  async cleanupExpiredTokens(): Promise<number> {
    const expiredTokens = await this.queueRepository.findExpiredTokens(new Date());
    for (const token of expiredTokens) {
      await this.queueRepository.updateStatus(token.tokenId, QueueTokenStatus.EXPIRED);
    }
    if (expiredTokens.length > 0) {
      this.logger.log(`만료 토큰 ${expiredTokens.length}건 정리`);
    }
    return expiredTokens.length;
  }

  async expireToken(tokenValue: string): Promise<void> {
    const token = await this.findTokenOrThrow(tokenValue);
    await this.queueRepository.updateStatus(token.tokenId, QueueTokenStatus.EXPIRED);
  }

  private async findTokenOrThrow(tokenValue: string): Promise<QueueToken> {
    const token = await this.queueRepository.findByTokenValue(tokenValue);
    if (!token) {
      throw new NotFoundException('토큰을 찾을 수 없습니다.');
    }
    return token;
  }
}
