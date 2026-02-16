import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './domain/payment.entity';
import { PaymentService } from './payment.service';
import { PaymentRepositoryImpl } from '../infrastructure/persistence/payment/payment.repository.impl';
import { ReservationModule } from '../reservation/reservation.module';
import { PointModule } from '../point/point.module';
import { PaymentController } from '../interfaces/controllers/payment.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), ReservationModule, PointModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    {
      provide: 'PaymentRepository',
      useClass: PaymentRepositoryImpl,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
