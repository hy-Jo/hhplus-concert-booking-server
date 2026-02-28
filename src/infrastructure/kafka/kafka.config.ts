export const KAFKA_CONFIG = {
  clientId: 'concert-reservation-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
};

export const KAFKA_TOPICS = {
  PAYMENT_COMPLETED: 'payment.completed',
  RESERVATION_EXPIRATION: 'reservation.expiration',
  NOTIFICATION_REQUEST: 'notification.request',
} as const;

export const KAFKA_CONSUMER_GROUPS = {
  DATA_PLATFORM: 'data-platform-service-group',
  RANKING: 'ranking-service-group',
  RESERVATION_EXPIRATION: 'reservation-expiration-group',
  NOTIFICATION: 'notification-service-group',
} as const;
