import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsensusStateEvent } from './ibc-events';
import { Kafka, Producer, Consumer } from 'kafkajs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { kafkaConfig } from '../config/kafka.config';
import { callJsonRpcMethod } from 'src/utils/json-rpc';

@Injectable()
export class IBCEventWatcherService implements OnModuleInit {
  private readonly logger = new Logger(IBCEventWatcherService.name);
  private kafkaProducer: Producer;
  private kafkaConsumer: Consumer;

  constructor(
    private httpService: HttpService,
    @InjectRepository(ConsensusStateEvent)
    private consensusStateRepository: Repository<ConsensusStateEvent>,
  ) {
    const kafka = new Kafka({
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
    });

    this.kafkaProducer = kafka.producer();
    this.kafkaConsumer = kafka.consumer({ groupId: kafkaConfig.consumerGroupId });
  }

  async onModuleInit() {
    await this.kafkaProducer.connect();
    await this.kafkaConsumer.connect();
    await this.kafkaConsumer.subscribe({ topic: kafkaConfig.topic, fromBeginning: true });

    this.kafkaConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        this.logger.log(`Received message: ${message.value.toString()}`);
        try {
          const decodedData = JSON.parse(message.value.toString());
          const consensusState = this.consensusStateRepository.create(decodedData);
          await this.consensusStateRepository.save(consensusState);
        } catch (error) {
          this.logger.error('Error processing message:', error.stack);
        }
      },
    });
  }

  @Cron(CronExpression.EVERY_SECOND)
  async handleCron() {
    try {
      const data = await callJsonRpcMethod('method', 'method');
      await this.sendToKafka(kafkaConfig.topic, data);
    } catch (error) {
      this.logger.error('Error in handleCron:', error.stack);
    }
  }

  async sendToKafka(topic: string, message: any) {
    try {
      await this.kafkaProducer.send({
        topic: topic || kafkaConfig.topic,
        messages: [{ value: JSON.stringify(message) }],
      });
    } catch (error) {
      this.logger.error('Error sending to Kafka:', error.stack);
    }
  }
}
