import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// Cardano-DB-Sync database (read-only)
export const DbSyncDatabaseConfig: TypeOrmModuleOptions = {
  name: 'dbsync',
  type: 'postgres',
  host: process.env.DBSYNC_HOST,
  port: +process.env.DBSYNC_PORT,
  username: process.env.DBSYNC_USERNAME,
  password: process.env.DBSYNC_PASSWORD,
  database: process.env.DBSYNC_NAME,
  entities: [],
  synchronize: false,
};
