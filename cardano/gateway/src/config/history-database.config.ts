import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const HistoryDatabaseConfig: TypeOrmModuleOptions = {
  name: 'history',
  type: 'postgres',
  host: process.env.BRIDGE_HISTORY_DB_HOST || process.env.HISTORY_DB_HOST,
  port: +(process.env.BRIDGE_HISTORY_DB_PORT || process.env.HISTORY_DB_PORT || 5432),
  username: process.env.BRIDGE_HISTORY_DB_USERNAME || process.env.HISTORY_DB_USERNAME,
  password: process.env.BRIDGE_HISTORY_DB_PASSWORD || process.env.HISTORY_DB_PASSWORD,
  database: process.env.BRIDGE_HISTORY_DB_NAME || process.env.HISTORY_DB_NAME,
  entities: [],
  synchronize: false,
};
