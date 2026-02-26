import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { DatabaseModule } from "./database/database.module";
import { ConcertModule } from "./concert/concert.module";
import { QueueModule } from "./queue/queue.module";
import { ReservationModule } from "./reservation/reservation.module";
import { PaymentModule } from "./payment/payment.module";
import { PointModule } from "./point/point.module";
import { DistributedLockModule } from "./infrastructure/distributed-lock/distributed-lock.module";
import { CacheModule } from "./infrastructure/cache/cache.module";
import { RankingModule } from "./ranking/ranking.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    DistributedLockModule,
    CacheModule,
    ConcertModule,
    QueueModule,
    ReservationModule,
    PaymentModule,
    PointModule,
    RankingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
