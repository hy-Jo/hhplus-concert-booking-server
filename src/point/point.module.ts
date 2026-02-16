import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserPointBalance } from './domain/user-point-balance.entity';
import { PointTransaction } from './domain/point-transaction.entity';
import { PointService } from './point.service';
import { PointRepositoryImpl } from '../infrastructure/persistence/point/point.repository.impl';
import { PointController } from '../interfaces/controllers/point.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserPointBalance, PointTransaction])],
  controllers: [PointController],
  providers: [
    PointService,
    {
      provide: 'PointRepository',
      useClass: PointRepositoryImpl,
    },
  ],
  exports: [PointService],
})
export class PointModule {}
