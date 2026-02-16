import { Module } from '@nestjs/common';
import { RedisModule as NestRedisModule } from '@nestjs-modules/ioredis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisConfig, redisConfig } from './redis.config';

@Module({
  imports: [
    NestRedisModule.forRootAsync({
      imports: [
        ConfigModule.forRoot({
          load: [redisConfig],
          envFilePath: `.env.${process.env.NODE_ENV}`,
        }),
      ],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<RedisConfig>('redis');
        return {
          type: 'single',
          url: `redis://${config.host}:${config.port}`,
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [NestRedisModule],
})
export class RedisConfigModule {}
