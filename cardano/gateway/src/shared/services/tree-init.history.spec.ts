import { HistoryConfigurationError } from '../../config/history-coverage';
import { ConfigService } from '@nestjs/config';
import { TreeInitService } from './tree-init.service';

describe('cold manifest startup readiness', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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
