import { Injectable, Logger } from '@nestjs/common';
import { PaymentCompletedEvent } from '../../payment/events/payment-completed.event';

@Injectable()
export class DataPlatformService {
  private readonly logger = new Logger(DataPlatformService.name);

  /**
   * 데이터 플랫폼에 예약 정보를 전송합니다. (Mock API)
   * 실제 환경에서는 HTTP 호출로 대체됩니다.
   */
  async sendReservationInfo(event: PaymentCompletedEvent): Promise<void> {
    this.logger.log(
      `[Mock API] 데이터 플랫폼 전송 — paymentId: ${event.paymentId}, userId: ${event.userId}, seatId: ${event.seatId}, amount: ${event.amount}`,
    );
  }
}
