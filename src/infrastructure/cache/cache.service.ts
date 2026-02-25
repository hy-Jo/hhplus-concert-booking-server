import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  private static readonly KEY_PREFIX = 'cache:';

  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * 캐시에서 데이터를 조회합니다.
   * 캐시 미스 시 null을 반환합니다.
   */
  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(CacheService.KEY_PREFIX + key);
    if (!data) return null;
    return JSON.parse(data) as T;
  }

  /**
   * 캐시에 데이터를 저장합니다.
   * @param ttlMs 캐시 만료 시간 (밀리초)
   */
  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.redis.set(
      CacheService.KEY_PREFIX + key,
      JSON.stringify(value),
      'PX',
      ttlMs,
    );
  }

  /**
   * 캐시를 무효화합니다.
   */
  async del(key: string): Promise<void> {
    await this.redis.del(CacheService.KEY_PREFIX + key);
  }

  /**
   * Cache-Aside 패턴: 캐시 조회 → 미스 시 loader 실행 → 결과 캐시 저장
   */
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await loader();
    await this.set(key, data, ttlMs);
    return data;
  }
}
