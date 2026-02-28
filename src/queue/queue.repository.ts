import { QueueToken } from './domain/queue-token.entity';

export interface QueueRepository {
  save(token: QueueToken): Promise<QueueToken>;
  findByTokenValue(tokenValue: string): Promise<QueueToken | null>;
  findByUserId(userId: string): Promise<QueueToken | null>;
  countWaiting(): Promise<number>;
  countActive(): Promise<number>;
  findExpiredTokens(now: Date): Promise<QueueToken[]>;
  updateStatus(tokenId: string, status: string): Promise<void>;
  /** WAITING Sorted Set에서 가장 앞의 N개 토큰을 ACTIVE로 전환 */
  activateNextTokens(count: number): Promise<number>;
}
