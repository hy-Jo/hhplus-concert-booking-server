import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './domain/reservation.entity';
import { ReservationService } from './reservation.service';
import { ReservationScheduler } from './reservation.scheduler';
import { ReservationRepositoryImpl } from '../infrastructure/persistence/reservation/reservation.repository.impl';
import { ConcertModule } from '../concert/concert.module';
import { ReservationController } from '../interfaces/controllers/reservation.controller';
import { DI_TOKENS } from '../common/di-tokens';
import { KafkaModule } from '../infrastructure/kafka/kafka.module';
import { ReservationExpirationConsumer } from './reservation-expiration.consumer';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation]), ConcertModule, KafkaModule],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    ReservationScheduler,
    ReservationExpirationConsumer,
    {
      provide: DI_TOKENS.RESERVATION_REPOSITORY,
      useClass: ReservationRepositoryImpl,
    },
  ],
  exports: [ReservationService, DI_TOKENS.RESERVATION_REPOSITORY],
})
export class ReservationModule {}
