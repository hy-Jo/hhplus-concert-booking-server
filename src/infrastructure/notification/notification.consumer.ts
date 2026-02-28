import { Injectable, OnModuleInit } from '@nestjs/common';
import { EachMessagePayload } from 'kafkajs';
import { KafkaConsumerService } from '../kafka/kafka.consumer.service';
import { KAFKA_CONSUMER_GROUPS, KAFKA_TOPICS } from '../kafka/kafka.config';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationConsumer extends KafkaConsumerService implements OnModuleInit {
  constructor(private readonly notificationService: NotificationService) {
    super(KAFKA_CONSUMER_GROUPS.NOTIFICATION, NotificationConsumer.name);
  }

  async onModuleInit() {
    await this.connect([KAFKA_TOPICS.NOTIFICATION_REQUEST]);
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
      this.logger.log(`Received notification request from ${topic}-${partition}: ${eventData.eventId}`);

      // 알림 발송
      await this.notificationService.send({
        userId: eventData.payload.userId,
        type: eventData.payload.type,
        title: eventData.payload.title,
        message: eventData.payload.message,
        data: eventData.payload.data,
      });

      this.logger.log(`Notification sent successfully: ${eventData.eventId}`);
    } catch (error) {
      this.logger.error('Failed to process notification request', error);
      // 에러 발생 시 재시도 로직 또는 Dead Letter Queue로 전송
    }
  }
}
