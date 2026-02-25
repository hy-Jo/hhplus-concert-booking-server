import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { QueueRepository } from '../../../queue/queue.repository';
import { QueueToken, QueueTokenStatus } from '../../../queue/domain/queue-token.entity';

@Injectable()
export class QueueRepositoryImpl implements QueueRepository {
  constructor(
    @InjectRepository(QueueToken)
    private readonly repo: Repository<QueueToken>,
  ) {}

  async save(token: QueueToken): Promise<QueueToken> {
    return this.repo.save(token);
  }

  async findByTokenValue(tokenValue: string): Promise<QueueToken | null> {
    return this.repo.findOne({ where: { tokenValue } });
  }

  async findByUserId(userId: string): Promise<QueueToken | null> {
    return this.repo.findOne({
      where: { userId },
      order: { issuedAt: 'DESC' },
    });
  }

  async countWaiting(): Promise<number> {
    return this.repo.count({
      where: { status: QueueTokenStatus.WAITING },
    });
  }

  async findExpiredTokens(now: Date): Promise<QueueToken[]> {
    return this.repo.find({
      where: {
        status: QueueTokenStatus.ACTIVE,
        expiresAt: LessThanOrEqual(now),
      },
    });
  }

  async updateStatus(tokenId: string, status: string): Promise<void> {
    await this.repo.update(tokenId, { status: status as QueueTokenStatus });
  }

  async countActive(): Promise<number> {
    return this.repo.count({
      where: { status: QueueTokenStatus.ACTIVE },
    });
  }

  async activateNextTokens(count: number): Promise<number> {
    const waitingTokens = await this.repo.find({
      where: { status: QueueTokenStatus.WAITING },
      order: { issuedAt: 'ASC' },
      take: count,
    });

    for (const token of waitingTokens) {
      token.status = QueueTokenStatus.ACTIVE;
      token.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await this.repo.save(token);
    }

    return waitingTokens.length;
  }
}
