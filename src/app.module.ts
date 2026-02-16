import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { ConcertModule } from "./concert/concert.module";
import { QueueModule } from "./queue/queue.module";
import { ReservationModule } from "./reservation/reservation.module";
import { PaymentModule } from "./payment/payment.module";
import { PointModule } from "./point/point.module";

@Module({
  imports: [
    DatabaseModule,
    ConcertModule,
    QueueModule,
    ReservationModule,
    PaymentModule,
    PointModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
