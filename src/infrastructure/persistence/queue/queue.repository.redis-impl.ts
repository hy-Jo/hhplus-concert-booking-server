import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { QueueRepository } from '../../../queue/queue.repository';
import { QueueToken, QueueTokenStatus } from '../../../queue/domain/queue-token.entity';

@Injectable()
export class QueueRepositoryRedisImpl implements QueueRepository {
  private static readonly TOKEN_KEY_PREFIX = 'queue:token:';
  private static readonly USER_KEY_PREFIX = 'queue:user:';
  private static readonly ID_KEY_PREFIX = 'queue:id:';
  private static readonly WAITING_SET = 'queue:waiting';
  private static readonly TTL_SECONDS = 10 * 60; // 10분

  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async save(token: QueueToken): Promise<QueueToken> {
    // tokenId가 없으면 UUID 생성 (DB의 PrimaryGeneratedColumn 역할)
    if (!token.tokenId) {
      token.tokenId = randomUUID();
    }

    const tokenKey = `${QueueRepositoryRedisImpl.TOKEN_KEY_PREFIX}${token.tokenValue}`;
    const userKey = `${QueueRepositoryRedisImpl.USER_KEY_PREFIX}${token.userId}`;
    const idKey = `${QueueRepositoryRedisImpl.ID_KEY_PREFIX}${token.tokenId}`;

    const data: Record<string, string> = {
      tokenId: token.tokenId,
      userId: token.userId,
      tokenValue: token.tokenValue,
      queuePosition: String(token.queuePosition),
      status: token.status,
      issuedAt: token.issuedAt.toISOString(),
      expiresAt: token.expiresAt.toISOString(),
    };

    const pipeline = this.redis.pipeline();

    // Hash에 토큰 상세정보 저장
    pipeline.hset(tokenKey, data);
    pipeline.expire(tokenKey, QueueRepositoryRedisImpl.TTL_SECONDS);

    // userId → tokenValue 매핑
    pipeline.set(userKey, token.tokenValue, 'EX', QueueRepositoryRedisImpl.TTL_SECONDS);

    // tokenId → tokenValue 역방향 매핑
    pipeline.set(idKey, token.tokenValue, 'EX', QueueRepositoryRedisImpl.TTL_SECONDS);

    // WAITING 상태면 Sorted Set에 추가 (score = issuedAt timestamp)
    if (token.status === QueueTokenStatus.WAITING) {
      pipeline.zadd(
        QueueRepositoryRedisImpl.WAITING_SET,
        token.issuedAt.getTime(),
        token.tokenValue,
      );
    }

    await pipeline.exec();

    return token;
  }

  async findByTokenValue(tokenValue: string): Promise<QueueToken | null> {
    const tokenKey = `${QueueRepositoryRedisImpl.TOKEN_KEY_PREFIX}${tokenValue}`;
    const data = await this.redis.hgetall(tokenKey);

    if (!data || !data.tokenValue) {
      return null;
    }

    return this.toQueueToken(data);
  }

  async findByUserId(userId: string): Promise<QueueToken | null> {
    const userKey = `${QueueRepositoryRedisImpl.USER_KEY_PREFIX}${userId}`;
    const tokenValue = await this.redis.get(userKey);

    if (!tokenValue) {
      return null;
    }

    return this.findByTokenValue(tokenValue);
  }

  async countWaiting(): Promise<number> {
    return this.redis.zcard(QueueRepositoryRedisImpl.WAITING_SET);
  }

  async findExpiredTokens(now: Date): Promise<QueueToken[]> {
    // Sorted Set에서 score(issuedAt) 기준으로 만료 시간이 지난 토큰 조회
    // 만료 기준: issuedAt + TTL <= now → issuedAt <= now - TTL
    const expiryCutoff = now.getTime() - QueueRepositoryRedisImpl.TTL_SECONDS * 1000;
    const tokenValues = await this.redis.zrangebyscore(
      QueueRepositoryRedisImpl.WAITING_SET,
      '-inf',
      expiryCutoff,
    );

    const tokens: QueueToken[] = [];
    for (const tokenValue of tokenValues) {
      const token = await this.findByTokenValue(tokenValue);
      if (token) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  async updateStatus(tokenId: string, status: string): Promise<void> {
    // tokenId → tokenValue 역방향 조회
    const idKey = `${QueueRepositoryRedisImpl.ID_KEY_PREFIX}${tokenId}`;
    const tokenValue = await this.redis.get(idKey);

    if (!tokenValue) {
      return;
    }

    const tokenKey = `${QueueRepositoryRedisImpl.TOKEN_KEY_PREFIX}${tokenValue}`;
    await this.redis.hset(tokenKey, 'status', status);

    // EXPIRED로 변경 시 Sorted Set에서 제거
    if (status === QueueTokenStatus.EXPIRED) {
      await this.redis.zrem(QueueRepositoryRedisImpl.WAITING_SET, tokenValue);
    }
  }

  private toQueueToken(data: Record<string, string>): QueueToken {
    const token = new QueueToken();
    token.tokenId = data.tokenId;
    token.userId = data.userId;
    token.tokenValue = data.tokenValue;
    token.queuePosition = parseInt(data.queuePosition, 10);
    token.status = data.status as QueueTokenStatus;
    token.issuedAt = new Date(data.issuedAt);
    token.expiresAt = new Date(data.expiresAt);
    return token;
  }
}
