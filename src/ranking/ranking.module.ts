import { Module } from '@nestjs/common';
import { RankingService } from './ranking.service';
import { RankingController } from '../interfaces/controllers/ranking.controller';
import { ConcertModule } from '../concert/concert.module';

@Module({
  imports: [ConcertModule],
  controllers: [RankingController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
