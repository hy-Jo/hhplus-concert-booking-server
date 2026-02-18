import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { QueueRepository } from './queue.repository';
import { QueueToken, QueueTokenStatus } from './domain/queue-token.entity';
import { randomUUID } from 'crypto';

@Injectable()
export class QueueService {
  private static readonly TOKEN_TTL_MS = 10 * 60 * 1000;

  constructor(
    @Inject('QueueRepository')
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
