import { Global, Module } from '@nestjs/common';
import { RedisConfigModule } from '../configuration/redis.module';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [RedisConfigModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
