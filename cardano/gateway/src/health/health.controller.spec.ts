import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';

describe('REST history health checks', () => {
  let module: TestingModule;
  let controller: HealthController;
  let request: jest.Mock;
  const originalFetch = global.fetch;
  const config = { get: jest.fn() };
  const database = { isInitialized: true, query: jest.fn() };
  const db = { pingCheck: jest.fn() };
  const metrics = {
    gatewayDbConnectionStatus: { set: jest.fn() },
    historyBackendConnectionStatus: { set: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    config.get.mockReturnValue('https://yaci.example/');
    db.pingCheck.mockResolvedValue({ gateway_db: { status: 'up' } });
    request = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      number: 10,
      hash: 'ab'.repeat(32),
      previous_block: 'cd'.repeat(32),
      slot: 100,
      epoch: 0,
      time: 1_000,
      slot_leader: 'pool1example',
      tx_count: 0,
    })));
    global.fetch = request;
    module = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: getDataSourceToken('gateway'), useValue: database },
        { provide: TypeOrmHealthIndicator, useValue: db },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await module.close();
  });

  it('starts without a history database provider and checks Yaci through REST', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.details.history_backend.status).toBe('up');
    expect(request).toHaveBeenCalledWith('https://yaci.example/api/v1/blocks/latest', expect.any(Object));
    expect(db.pingCheck).toHaveBeenCalledTimes(1);
    expect(db.pingCheck).toHaveBeenCalledWith('gateway_db', { connection: database });
    expect(database.query).not.toHaveBeenCalled();
    expect(metrics.historyBackendConnectionStatus.set).toHaveBeenLastCalledWith(1);
  });

  it('returns an unhealthy check and clears the backend metric when REST has no tip', async () => {
    request.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(controller.check()).rejects.toThrow('Service Unavailable');
    expect(metrics.historyBackendConnectionStatus.set).toHaveBeenLastCalledWith(0);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('reports detailed REST status separately from the application database', async () => {
    const result = await controller.databaseHealth();
    expect(result.gateway_db).toEqual({ status: 'healthy', connection: true });
    expect(result.history_backend).toEqual({ status: 'healthy', connection: true });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports missing REST configuration as unhealthy without a SQL fallback', async () => {
    config.get.mockReturnValue(undefined);
    const result = await controller.databaseHealth();
    expect(result.history_backend).toEqual({ status: 'unhealthy', connection: false });
    expect(request).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });
});
