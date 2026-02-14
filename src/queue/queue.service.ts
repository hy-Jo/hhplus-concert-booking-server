import { Injectable, Inject } from '@nestjs/common';
import { QueueRepository } from './queue.repository';
import { QueueToken } from './domain/queue-token.entity';

@Injectable()
export class QueueService {
  constructor(
    @Inject('QueueRepository')
    private readonly queueRepository: QueueRepository,
  ) {}

  async issueToken(userId: string): Promise<QueueToken> {
    throw new Error('Not implemented');
  }

  async validateToken(tokenValue: string): Promise<QueueToken> {
    throw new Error('Not implemented');
  }

  async getQueueStatus(tokenValue: string): Promise<{ position: number; status: string }> {
    throw new Error('Not implemented');
  }

  async expireToken(tokenValue: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
