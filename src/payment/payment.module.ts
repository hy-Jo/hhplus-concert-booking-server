import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './domain/payment.entity';
import { PaymentService } from './payment.service';
import { PaymentRepositoryImpl } from '../infrastructure/persistence/payment/payment.repository.impl';
import { PointModule } from '../point/point.module';
import { RankingModule } from '../ranking/ranking.module';
import { ConcertModule } from '../concert/concert.module';
import { PaymentController } from '../interfaces/controllers/payment.controller';
import { DI_TOKENS } from '../common/di-tokens';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), PointModule, RankingModule, ConcertModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    {
      provide: DI_TOKENS.PAYMENT_REPOSITORY,
      useClass: PaymentRepositoryImpl,
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
