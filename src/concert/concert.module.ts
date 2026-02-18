import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Concert } from './domain/concert.entity';
import { ConcertSchedule } from './domain/concert-schedule.entity';
import { Seat } from './domain/seat.entity';
import { ConcertService } from './concert.service';
import { ConcertRepositoryImpl } from '../infrastructure/persistence/concert/concert.repository.impl';
import { ConcertController } from '../interfaces/controllers/concert.controller';
import { DI_TOKENS } from '../common/di-tokens';

@Module({
  imports: [TypeOrmModule.forFeature([Concert, ConcertSchedule, Seat])],
  controllers: [ConcertController],
  providers: [
    ConcertService,
    {
      provide: DI_TOKENS.CONCERT_REPOSITORY,
      useClass: ConcertRepositoryImpl,
    },
  ],
  exports: [ConcertService, DI_TOKENS.CONCERT_REPOSITORY],
})
export class ConcertModule {}
