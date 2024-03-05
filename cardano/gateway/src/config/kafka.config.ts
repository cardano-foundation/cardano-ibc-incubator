import * as dotenv from 'dotenv';

dotenv.config();

export const kafkaConfig = {
  clientId: process.env.KAFKA_CLIENT_ID || 'ibc-events',
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'],
  consumerGroupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'ibc-events-group',
  topic: process.env.KAFKA_TOPIC || 'ibc.events',
};