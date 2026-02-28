import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { KAFKA_CONFIG } from './kafka.config';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private kafka: Kafka;
  private producer: Producer;
  private isConnected = false;

  constructor() {
    this.kafka = new Kafka(KAFKA_CONFIG);
    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log('Kafka Producer connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka Producer', error);
      // 개발 환경에서는 Kafka 없이도 앱이 실행되도록 에러를 삼킴
      // 운영 환경에서는 throw error; 해야 함
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      await this.producer.disconnect();
      this.logger.log('Kafka Producer disconnected');
    }
  }

  async send(record: ProducerRecord): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Kafka Producer is not connected, skipping message send');
      return;
    }

    try {
      await this.producer.send(record);
      this.logger.log(`Message sent to topic: ${record.topic}`);
    } catch (error) {
      this.logger.error(`Failed to send message to topic: ${record.topic}`, error);
      throw error;
    }
  }

  async sendPaymentCompletedEvent(event: {
    paymentId: string;
    userId: string;
    reservationId: string;
    seatId: string;
    amount: number;
  }): Promise<void> {
    const message = {
      eventId: `evt_${Date.now()}`,
      eventType: 'payment.completed',
      eventTime: new Date().toISOString(),
      payload: event,
    };

    await this.send({
      topic: 'payment.completed',
      messages: [
        {
          key: event.userId, // 같은 사용자는 같은 파티션으로 (순서 보장)
          value: JSON.stringify(message),
        },
      ],
    });
  }
}
