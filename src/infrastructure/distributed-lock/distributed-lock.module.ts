import { Global, Module } from '@nestjs/common';
import { RedisConfigModule } from '../configuration/redis.module';
import { DistributedLockService } from './distributed-lock.service';

@Global()
@Module({
  imports: [RedisConfigModule],
  providers: [DistributedLockService],
  exports: [DistributedLockService],
})
export class DistributedLockModule {}
