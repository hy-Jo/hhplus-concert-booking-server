import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EachMessagePayload } from 'kafkajs';
import { KafkaConsumerService } from '../infrastructure/kafka/kafka.consumer.service';
import { KAFKA_CONSUMER_GROUPS, KAFKA_TOPICS } from '../infrastructure/kafka/kafka.config';
import { ReservationService } from './reservation.service';
import { KafkaProducerService } from '../infrastructure/kafka/kafka.producer.service';

@Injectable()
export class ReservationExpirationConsumer extends KafkaConsumerService implements OnModuleInit {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {
    super(KAFKA_CONSUMER_GROUPS.RESERVATION_EXPIRATION, ReservationExpirationConsumer.name);
  }

  async onModuleInit() {
    await this.connect([KAFKA_TOPICS.RESERVATION_EXPIRATION]);
  }

  protected async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    try {
      const value = message.value?.toString();
      if (!value) {
        this.logger.warn('Empty message received');
        return;
      }

      const eventData = JSON.parse(value);
      this.logger.log(`Received expiration event from ${topic}-${partition}: ${eventData.eventId}`);

      // 만료 시간까지 대기 (지연 메시지 처리)
      const now = new Date();
      const expiresAt = new Date(eventData.payload.expiresAt);

      if (now < expiresAt) {
        const delay = expiresAt.getTime() - now.getTime();
        this.logger.log(`Waiting ${delay}ms until expiration time...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // 예약 만료 처리 (조건부 UPDATE로 멱등성 보장)
      const updated = await this.reservationService.expireReservation(
        eventData.payload.reservationId,
      );

      if (updated) {
        this.logger.log(`Reservation ${eventData.payload.reservationId} expired successfully`);

        // 만료 알림 발송 (선택)
        await this.kafkaProducer.sendNotificationRequest({
          userId: eventData.payload.userId,
          type: 'RESERVATION_EXPIRED',
          title: '예약 만료',
          message: '5분 이내 결제하지 않아 예약이 만료되었습니다.',
          data: {
            reservationId: eventData.payload.reservationId,
            seatId: eventData.payload.seatId,
          },
        });
      } else {
        this.logger.warn(
          `Reservation ${eventData.payload.reservationId} was already expired or confirmed`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to process expiration message', error);
      // 에러 발생 시: 재시도 로직 또는 Dead Letter Queue로 전송
      // 현재는 로그만 남기고 다음 메시지 처리
    }
  }
}
