import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_CONFIG } from './kafka.config';

export abstract class KafkaConsumerService implements OnModuleDestroy {
  protected readonly logger: Logger;
  private kafka: Kafka;
  protected consumer: Consumer;
  private isConnected = false;

  constructor(
    private readonly groupId: string,
    loggerContext: string,
  ) {
    this.logger = new Logger(loggerContext);
    this.kafka = new Kafka(KAFKA_CONFIG);
    this.consumer = this.kafka.consumer({ groupId });
  }

  async connect(topics: string[]): Promise<void> {
    try {
      await this.consumer.connect();
      this.isConnected = true;
      this.logger.log(`Kafka Consumer connected (group: ${this.groupId})`);

      for (const topic of topics) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
        this.logger.log(`Subscribed to topic: ${topic}`);
      }

      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });
    } catch (error) {
      this.logger.error('Failed to connect Kafka Consumer', error);
      // 개발 환경에서는 Kafka 없이도 앱이 실행되도록 에러를 삼킴
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      await this.consumer.disconnect();
      this.logger.log('Kafka Consumer disconnected');
    }
  }

  protected abstract handleMessage(payload: EachMessagePayload): Promise<void>;
}
