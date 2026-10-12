import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { GatewayDatabaseConfig } from './gateway-database.config';

// A separate pool for history snapshots in the same Gateway application database.
export const HistoryDatabaseConfig: TypeOrmModuleOptions = {
  ...GatewayDatabaseConfig,
  name: 'history',
  entities: [],
  synchronize: false,
  extra: { connectionTimeoutMillis: 30_000 },
};
