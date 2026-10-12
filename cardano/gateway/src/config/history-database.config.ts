import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// Gateway-owned REST import and bridge projection. Never point this at Yaci Store PostgreSQL.
export const HistoryDatabaseConfig: TypeOrmModuleOptions = {
  name: 'history',
  type: 'postgres',
  host: process.env.HISTORY_DB_HOST,
  port: +(process.env.HISTORY_DB_PORT || 5432),
  username: process.env.HISTORY_DB_USERNAME,
  password: process.env.HISTORY_DB_PASSWORD,
  database: process.env.HISTORY_DB_NAME,
  entities: [],
  synchronize: false,
  extra: { connectionTimeoutMillis: 30_000 },
};
