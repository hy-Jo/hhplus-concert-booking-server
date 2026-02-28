import { Module } from '@nestjs/common';
import { DataPlatformService } from './data-platform.service';
import { DataPlatformConsumer } from './data-platform.consumer';

@Module({
  providers: [DataPlatformService, DataPlatformConsumer],
  exports: [DataPlatformService],
})
export class DataPlatformModule {}
