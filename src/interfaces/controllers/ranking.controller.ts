import { Controller, Get, Query } from '@nestjs/common';
import { RankingService } from '../../ranking/ranking.service';
import { SoldOutRankingResponse, PopularRankingResponse } from '../dto/ranking.dto';

@Controller('api/rankings')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get('sold-out')
  async getSoldOutRanking(
    @Query('limit') limit: string = '10',
  ): Promise<{ rankings: SoldOutRankingResponse[] }> {
    const entries = await this.rankingService.getSoldOutRanking(Number(limit) || 10);
    return {
      rankings: entries.map((entry, index) => ({
        rank: index + 1,
        scheduleId: entry.scheduleId,
        concertTitle: entry.concertTitle,
        concertDate: entry.concertDate,
        soldOutDurationSec: entry.score,
      })),
    };
  }

  @Get('popular')
  async getPopularRanking(
    @Query('limit') limit: string = '10',
  ): Promise<{ rankings: PopularRankingResponse[] }> {
    const entries = await this.rankingService.getPopularRanking(Number(limit) || 10);
    return {
      rankings: entries.map((entry, index) => ({
        rank: index + 1,
        scheduleId: entry.scheduleId,
        concertTitle: entry.concertTitle,
        concertDate: entry.concertDate,
        reservationCount: entry.score,
      })),
    };
  }
}
