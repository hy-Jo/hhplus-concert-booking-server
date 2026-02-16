import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueRepositoryRedisImpl } from '../infrastructure/persistence/queue/queue.repository.redis-impl';
import { QueueController } from '../interfaces/controllers/queue.controller';
import { RedisConfigModule } from '../infrastructure/configuration/redis.module';

@Module({
  imports: [RedisConfigModule],
  controllers: [QueueController],
  providers: [
    QueueService,
    {
      provide: 'QueueRepository',
      useClass: QueueRepositoryRedisImpl,
    },
  ],
  exports: [QueueService],
})
export class QueueModule {}
