import { QueueToken } from './domain/queue-token.entity';

export interface QueueRepository {
  save(token: QueueToken): Promise<QueueToken>;
  findByTokenValue(tokenValue: string): Promise<QueueToken | null>;
  findByUserId(userId: string): Promise<QueueToken | null>;
  countWaiting(): Promise<number>;
  findExpiredTokens(now: Date): Promise<QueueToken[]>;
  updateStatus(tokenId: string, status: string): Promise<void>;
}
