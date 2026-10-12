import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { gatewayPostgresConfig } from './gateway-postgres.config';

const postgres = gatewayPostgresConfig();

// Gateway application database (read/write)
export const GatewayDatabaseConfig: TypeOrmModuleOptions = {
  name: 'gateway',
  type: 'postgres',
  url: postgres.connectionString,
  host: postgres.host,
  port: postgres.port,
  username: postgres.user,
  password: postgres.password,
  database: postgres.database,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: process.env.GATEWAY_DB_SYNCHRONIZE === 'true',
};
