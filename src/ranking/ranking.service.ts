import { Injectable, Inject } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConcertRepository } from '../concert/concert.repository';
import { DI_TOKENS } from '../common/di-tokens';

export interface RankingEntry {
  scheduleId: string;
  concertTitle: string;
  concertDate: string;
  score: number;
}

@Injectable()
export class RankingService {
  private static readonly TOTAL_SEATS = 50;
  private static readonly RESERVATION_COUNT_KEY = 'ranking:reservation-count';
  private static readonly SOLD_OUT_SPEED_KEY = 'ranking:sold-out-speed';
  private static readonly FIRST_RESERVATION_PREFIX = 'ranking:first-reservation:';

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject(DI_TOKENS.CONCERT_REPOSITORY)
    private readonly concertRepository: ConcertRepository,
  ) {}

  /**
   * 결제 확정(CONFIRMED) 시 호출하여 랭킹 데이터를 갱신합니다.
   * 1) 예약 수 +1 (ZINCRBY)
   * 2) 첫 예약 시각 기록 (SET NX)
   * 3) 매진 시 소요 시간 기록 (ZADD)
   */
  async onReservationConfirmed(scheduleId: string): Promise<void> {
    const now = Date.now();

    // 첫 예약 시각 기록 (NX: 이미 존재하면 무시)
    await this.redis.set(
      RankingService.FIRST_RESERVATION_PREFIX + scheduleId,
      now.toString(),
      'PX',
      24 * 60 * 60 * 1000, // 24시간 TTL
      'NX',
    );

    // 예약 수 +1
    const newCount = await this.redis.zincrby(
      RankingService.RESERVATION_COUNT_KEY,
      1,
      scheduleId,
    );

    // 매진 판정: 전체 좌석 수에 도달하면 매진 속도 기록
    if (Number(newCount) >= RankingService.TOTAL_SEATS) {
      const firstReservationMs = await this.redis.get(
        RankingService.FIRST_RESERVATION_PREFIX + scheduleId,
      );

      if (firstReservationMs) {
        const durationSec = (now - Number(firstReservationMs)) / 1000;
        // NX: 이미 매진 기록이 있으면 덮어쓰지 않음
        await this.redis.zadd(
          RankingService.SOLD_OUT_SPEED_KEY,
          'NX',
          durationSec,
          scheduleId,
        );
      }
    }
  }

  /**
   * 매진 속도 랭킹 조회 (빠른 순 — score 오름차순)
   */
  async getSoldOutRanking(limit: number = 10): Promise<RankingEntry[]> {
    const results = await this.redis.zrange(
      RankingService.SOLD_OUT_SPEED_KEY,
      0,
      limit - 1,
      'WITHSCORES',
    );

    return this.enrichWithConcertInfo(results);
  }

  /**
   * 인기 콘서트 랭킹 조회 (예약 많은 순 — score 내림차순)
   */
  async getPopularRanking(limit: number = 10): Promise<RankingEntry[]> {
    const results = await this.redis.zrevrange(
      RankingService.RESERVATION_COUNT_KEY,
      0,
      limit - 1,
      'WITHSCORES',
    );

    return this.enrichWithConcertInfo(results);
  }

  /**
   * Redis ZSET 결과 [member, score, member, score, ...] 를
   * Concert 정보와 결합하여 RankingEntry[]로 변환합니다.
   */
  private async enrichWithConcertInfo(
    zsetResults: string[],
  ): Promise<RankingEntry[]> {
    const entries: RankingEntry[] = [];

    for (let i = 0; i < zsetResults.length; i += 2) {
      const scheduleId = zsetResults[i];
      const score = Number(zsetResults[i + 1]);

      const schedule = await this.concertRepository.findScheduleWithConcert(scheduleId);

      entries.push({
        scheduleId,
        concertTitle: schedule?.concert?.title ?? 'Unknown',
        concertDate: schedule?.concertDate ?? 'Unknown',
        score,
      });
    }

    return entries;
  }
}
