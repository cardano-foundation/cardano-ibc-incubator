import { Client } from 'pg';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { gatewayPostgresConfig } from './gateway-postgres.config';

describe('shared Gateway database', () => {
  it('uses the application database for history even when old Yaci credentials remain in the environment', async () => {
    const original = process.env;
    process.env = {
      ...original,
      GATEWAY_DB_URL: '',
      GATEWAY_DB_HOST: 'gateway-db',
      GATEWAY_DB_PORT: '5433',
      GATEWAY_DB_NAME: 'gateway_app',
      GATEWAY_DB_USERNAME: 'operator',
      GATEWAY_DB_PASSWORD: 'application-secret',
      HISTORY_DB_HOST: 'private-yaci-db',
      HISTORY_DB_NAME: 'yaci_store',
      HISTORY_DB_USERNAME: 'yaci',
      HISTORY_DB_PASSWORD: 'provider-secret',
      GATEWAY_DB_SYNCHRONIZE: 'true',
    };
    try {
      await jest.isolateModulesAsync(async () => {
        const { GatewayDatabaseConfig } = await import('./gateway-database.config');
        const { HistoryDatabaseConfig } = await import('./history-database.config');
        const history = new DataSource(HistoryDatabaseConfig as DataSourceOptions);
        expect(history.options).toMatchObject({
          host: 'gateway-db', port: 5433, database: 'gateway_app',
          username: 'operator', password: 'application-secret',
          entities: [], synchronize: false,
        });
        expect(history.driver.database).toBe(new DataSource(GatewayDatabaseConfig as DataSourceOptions).driver.database);
        expect(gatewayPostgresConfig()).toMatchObject({
          host: 'gateway-db', port: 5433, database: 'gateway_app',
          user: 'operator', password: 'application-secret',
        });
      });
    } finally {
      process.env = original;
    }
  });

  it('resolves a connection URL to the same database in the worker and Gateway', () => {
    const postgres = gatewayPostgresConfig({
      GATEWAY_DB_URL: 'postgres://operator:secret@application-db:5434/gateway_app',
      GATEWAY_DB_HOST: 'unused-host', GATEWAY_DB_NAME: 'unused-database',
    });
    const worker = new Client(postgres);
    const gateway = new DataSource({
      type: 'postgres', url: postgres.connectionString,
      host: postgres.host, port: postgres.port, database: postgres.database,
      username: postgres.user, password: postgres.password,
    });
    expect(worker).toMatchObject({ host: 'application-db', port: 5434, database: 'gateway_app', user: 'operator' });
    expect(gateway.driver.database).toBe(worker.database);
  });
});
