import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueScheduler } from './queue.scheduler';
import { QueueRepositoryRedisImpl } from '../infrastructure/persistence/queue/queue.repository.redis-impl';
import { QueueController } from '../interfaces/controllers/queue.controller';
import { RedisConfigModule } from '../infrastructure/configuration/redis.module';
import { DI_TOKENS } from '../common/di-tokens';

@Module({
  imports: [RedisConfigModule],
  controllers: [QueueController],
  providers: [
    QueueService,
    QueueScheduler,
    {
      provide: DI_TOKENS.QUEUE_REPOSITORY,
      useClass: QueueRepositoryRedisImpl,
    },
  ],
  exports: [QueueService],
})
export class QueueModule {}
