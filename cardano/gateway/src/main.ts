import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { grpcClientOptions } from './grpc-client.options';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ApiLimitInterceptor } from './security/api-limit.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalInterceptors(new ApiLimitInterceptor());
  app.connectMicroservice<MicroserviceOptions>(grpcClientOptions, { inheritAppConfig: true });
  app.connectMicroservice<MicroserviceOptions>({ transport: Transport.TCP }, { inheritAppConfig: true });
  app.useGlobalPipes(new ValidationPipe());
  await app.startAllMicroservices();
  const config = new DocumentBuilder().setTitle('IBC Cardano API').setVersion('1.0').build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger', app, document);
  const port = Number(process.env.PORT) || 8000;
  await app.listen(port);
}
bootstrap();
