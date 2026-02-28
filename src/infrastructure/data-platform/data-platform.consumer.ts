import { Injectable, OnModuleInit } from '@nestjs/common';
import { EachMessagePayload } from 'kafkajs';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { KAFKA_CONSUMER_GROUPS, KAFKA_TOPICS } from '../kafka/kafka.config';
import { DataPlatformService } from './data-platform.service';
import { PaymentCompletedEvent } from '../../payment/events/payment-completed.event';

@Injectable()
export class DataPlatformConsumer extends KafkaConsumerService implements OnModuleInit {
  constructor(private readonly dataPlatformService: DataPlatformService) {
    super(KAFKA_CONSUMER_GROUPS.DATA_PLATFORM, DataPlatformConsumer.name);
  }

  async onModuleInit() {
    await this.connect([KAFKA_TOPICS.PAYMENT_COMPLETED]);
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
      this.logger.log(`Received message from ${topic}-${partition}: ${eventData.eventId}`);

      // PaymentCompletedEvent 형식으로 변환
      const event = new PaymentCompletedEvent(
        eventData.payload.paymentId,
        eventData.payload.userId,
        eventData.payload.reservationId,
        eventData.payload.seatId,
        eventData.payload.amount,
      );

      // 기존 서비스 로직 호출
      await this.dataPlatformService.sendReservationInfo(event);

      this.logger.log(`Successfully processed event: ${eventData.eventId}`);
    } catch (error) {
      this.logger.error('Failed to process message', error);
      // 에러 발생 시 재시도 로직 또는 Dead Letter Queue로 전송
      // 현재는 로그만 남기고 다음 메시지 처리
    }
  }
}
