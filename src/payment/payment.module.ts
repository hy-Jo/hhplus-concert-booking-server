import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './domain/payment.entity';
import { PaymentService } from './payment.service';
import { PaymentRepositoryImpl } from '../infrastructure/persistence/payment/payment.repository.impl';
import { PointModule } from '../point/point.module';
import { RankingModule } from '../ranking/ranking.module';
import { ConcertModule } from '../concert/concert.module';
import { DataPlatformModule } from '../infrastructure/data-platform/data-platform.module';
import { PaymentController } from '../interfaces/controllers/payment.controller';
import { PaymentEventHandler } from './events/payment-event.handler';
import { DI_TOKENS } from '../common/di-tokens';
import { KafkaModule } from '../infrastructure/kafka/kafka.module';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), PointModule, RankingModule, ConcertModule, DataPlatformModule, KafkaModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymentEventHandler,
    {
      provide: DI_TOKENS.PAYMENT_REPOSITORY,
      useClass: PaymentRepositoryImpl,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
