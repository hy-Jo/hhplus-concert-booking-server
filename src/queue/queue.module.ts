import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueToken } from './domain/queue-token.entity';
import { QueueService } from './queue.service';
import { QueueRepositoryImpl } from '../infrastructure/persistence/queue/queue.repository.impl';
import { QueueController } from '../interfaces/controllers/queue.controller';

@Module({
  imports: [TypeOrmModule.forFeature([QueueToken])],
  controllers: [QueueController],
  providers: [
    QueueService,
    {
      provide: 'QueueRepository',
      useClass: QueueRepositoryImpl,
    },
  ],
  exports: [QueueService],
})
export class QueueModule {}
