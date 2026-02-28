import { Injectable, Logger } from '@nestjs/common';

export interface NotificationRequest {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  /**
   * 알림을 발송합니다 (Mock: 로그만 출력)
   * 실제 환경에서는 FCM, SMS, 이메일 등으로 전송됩니다.
   */
  async send(notification: NotificationRequest): Promise<void> {
    this.logger.log(
      `[Mock Notification] userId: ${notification.userId}, type: ${notification.type}, title: ${notification.title}, message: ${notification.message}`,
    );

    // 실제 구현 예시:
    // if (notification.type === 'PAYMENT_CONFIRMED') {
    //   await this.fcmService.send(notification.userId, notification.title, notification.message);
    // } else if (notification.type === 'RESERVATION_EXPIRED') {
    //   await this.smsService.send(notification.userId, notification.message);
    // }
  }
}
