import { HistoryConfigurationError } from '../../config/history-coverage';
import { ConfigService } from '@nestjs/config';
import { TreeInitService } from './tree-init.service';
import * as historyCoverage from '../../config/history-coverage';

describe('cold manifest startup readiness', () => {
  const originalRecoveryMode = process.env.GATEWAY_HISTORICAL_READ_ONLY;
  afterEach(() => {
    if (originalRecoveryMode === undefined) delete process.env.GATEWAY_HISTORICAL_READ_ONLY;
    else process.env.GATEWAY_HISTORICAL_READ_ONLY = originalRecoveryMode;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it('authenticates history bootstrap without requiring current custody in explicit read-only mode', async () => {
    process.env.GATEWAY_HISTORICAL_READ_ONLY = 'true';
    const verify = jest.spyOn(historyCoverage, 'verifyHistoryCoverage').mockResolvedValue(undefined);
    const manifest = { history: { format: 'cardano-history-v1' } };
    const manager = { query: jest.fn() };
    const database = { transaction: async (_: string, action: any) => action(manager) };
    const live = jest.fn().mockRejectedValue(new Error('Bridge migration is in progress'));
    const cache = { ensureSchema: jest.fn() };
    const store = { rebuildTreeFromChain: jest.fn() };
    const service = new TreeInitService({ findUtxoAtHostStateNFT: live } as never, cache as never,
      store as never, { get: () => manifest } as never, database as never);
    await service.onModuleInit();
    expect(verify).toHaveBeenCalledWith(manager, manifest);
    expect(live).not.toHaveBeenCalled();
    expect(store.rebuildTreeFromChain).not.toHaveBeenCalled();
    expect(cache.ensureSchema).toHaveBeenCalled();
    verify.mockRejectedValue(new HistoryConfigurationError('wrong bootstrap'));
    await expect(service.onModuleInit()).rejects.toThrow('wrong bootstrap');
  });
  it('keeps startup pending until providers/history and tree verification succeed', async () => {
    jest.useFakeTimers();
    const config = {
      get: (key: string) => (key === 'bridgeManifest' ? { history: { format: 'cardano-history-v1' } } : 30),
    };
    const service = new TreeInitService({} as never, {} as never, {} as never, config as ConfigService);
    const initialize = jest
      .spyOn(service as any, 'initializeTree')
      .mockRejectedValueOnce(new Error('required history missing'))
      .mockResolvedValue(undefined);
    let ready = false;
    const startup = service.onModuleInit().then(() => {
      ready = true;
    });
    await jest.advanceTimersByTimeAsync(9999);
    expect(ready).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await startup;
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(ready).toBe(true);
  });
  it('fails immediately for a checkpoint on another chain instead of waiting for catch-up', async () => {
    jest.useFakeTimers();
    const manifest = {
      cardano: { network_magic: 2 },
      history: {
        format: 'cardano-history-v1',
        start: { slot: 100, block_height: 5, block_hash: 'aa'.repeat(32) },
        host_state_nft_mint: { tx_hash: 'bb'.repeat(32), output_index: 0 },
      },
    };
    const config = { get: (key: string) => (key === 'bridgeManifest' ? manifest : 30) };
    const query = jest.fn(async (text: string) =>
      text.startsWith('SET') ? [] : [{ number: 5, hash: 'cc'.repeat(32), slot: 100 }],
    );
    const database = { transaction: async (_isolation: string, read: any) => read({ query }) };
    const lucid = { findUtxoAtHostStateNFT: async () => ({ txHash: 'dd'.repeat(32), outputIndex: 0 }) };
    const service = new TreeInitService(
      lucid as never,
      {} as never,
      {} as never,
      config as ConfigService,
      database as never,
    );
    await expect(service.onModuleInit()).rejects.toThrow(HistoryConfigurationError);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('fails clearly after the configured history wait expires', async () => {
    jest.useFakeTimers();
    const config = { get: (key: string) => (key === 'bridgeManifest' ? { history: {} } : 1) };
    const service = new TreeInitService({} as never, {} as never, {} as never, config as ConfigService);
    jest.spyOn(service as any, 'initializeTree').mockRejectedValue(new Error('required history missing'));
    const failed = expect(service.onModuleInit()).rejects.toThrow('required history missing');
    await jest.advanceTimersByTimeAsync(1000);
    await failed;
  });
});
