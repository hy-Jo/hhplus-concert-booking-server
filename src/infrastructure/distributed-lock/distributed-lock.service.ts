import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export class DistributedLockAcquisitionError extends Error {
  constructor(key: string) {
    super(`분산락 획득 실패: ${key}`);
    this.name = 'DistributedLockAcquisitionError';
  }
}

interface LockOptions {
  /** 락 만료 시간 (ms). 기본값: 5000ms */
  ttlMs?: number;
  /** 락 획득 재시도 최대 대기 시간 (ms). 기본값: 3000ms */
  waitMs?: number;
  /** 재시도 간격 (ms). 기본값: 50ms */
  retryIntervalMs?: number;
}

@Injectable()
export class DistributedLockService {
  // Lua 스크립트: 소유자 검증 후 삭제 (atomic)
  private static readonly UNLOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * 분산락을 획득하고, callback을 실행한 뒤, 락을 해제합니다.
   *
   * 핵심: 분산락은 DB 트랜잭션 바깥에서 감싸야 합니다.
   * 락 획득 → DB Tx 시작 → 작업 수행 → DB Tx 커밋 → 락 해제
   * 이렇게 해야 DB 커넥션 풀 고갈을 방지할 수 있습니다.
   */
  async withLock<T>(
    key: string,
    callback: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    const lockValue = randomUUID();
    const ttlMs = options?.ttlMs ?? 5000;
    const waitMs = options?.waitMs ?? 3000;
    const retryIntervalMs = options?.retryIntervalMs ?? 50;

    const acquired = await this.acquire(lockKey, lockValue, ttlMs, waitMs, retryIntervalMs);
    if (!acquired) {
      throw new DistributedLockAcquisitionError(key);
    }

    try {
      return await callback();
    } finally {
      await this.release(lockKey, lockValue);
    }
  }

  private async acquire(
    lockKey: string,
    lockValue: string,
    ttlMs: number,
    waitMs: number,
    retryIntervalMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      // SET key value NX PX ttl — 키가 없을 때만 설정
      const result = await this.redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        return true;
      }
      await this.sleep(retryIntervalMs);
    }

    return false;
  }

  private async release(lockKey: string, lockValue: string): Promise<void> {
    // Lua 스크립트로 소유자만 삭제 가능 (atomic)
    await this.redis.eval(
      DistributedLockService.UNLOCK_SCRIPT,
      1,
      lockKey,
      lockValue,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
