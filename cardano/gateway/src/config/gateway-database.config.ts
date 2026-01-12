import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// Gateway application database (read/write)
export const GatewayDatabaseConfig: TypeOrmModuleOptions = {
  name: 'gateway',
  type: 'postgres',
  host: process.env.GATEWAY_DB_HOST,
  port: +process.env.GATEWAY_DB_PORT,
  username: process.env.GATEWAY_DB_USERNAME,
  password: process.env.GATEWAY_DB_PASSWORD,
  database: process.env.GATEWAY_DB_NAME,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: process.env.GATEWAY_DB_SYNCHRONIZE === 'true',
};
