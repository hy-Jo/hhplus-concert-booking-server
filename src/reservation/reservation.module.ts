import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './domain/reservation.entity';
import { ReservationService } from './reservation.service';
import { ReservationRepositoryImpl } from '../infrastructure/persistence/reservation/reservation.repository.impl';
import { ConcertModule } from '../concert/concert.module';
import { ReservationController } from '../interfaces/controllers/reservation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation]), ConcertModule],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    {
      provide: 'RESERVATION_REPOSITORY',
      useClass: ReservationRepositoryImpl,
    },
  ],
  exports: [ReservationService, 'RESERVATION_REPOSITORY'],
})
export class ReservationModule {}
