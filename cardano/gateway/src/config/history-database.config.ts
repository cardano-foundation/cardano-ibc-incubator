import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const HistoryDatabaseConfig: TypeOrmModuleOptions = {
  name: 'history',
  type: 'postgres',
  host: process.env.HISTORY_DB_HOST || process.env.DBSYNC_HOST,
  port: +(process.env.HISTORY_DB_PORT || process.env.DBSYNC_PORT || 5432),
  username: process.env.HISTORY_DB_USERNAME || process.env.DBSYNC_USERNAME,
  password: process.env.HISTORY_DB_PASSWORD || process.env.DBSYNC_PASSWORD,
  database: process.env.HISTORY_DB_NAME || process.env.DBSYNC_NAME,
  entities: [],
  synchronize: false,
};
