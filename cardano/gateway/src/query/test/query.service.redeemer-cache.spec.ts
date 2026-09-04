import { Logger } from '@nestjs/common';
import { QueryService, TX_REDEEMER_CACHE_MAX_ENTRIES, TX_REDEEMER_CACHE_TTL_MS } from '../services/query.service';

describe('QueryService transaction redeemer cache', () => {
  const makeService = (fetchTransactionEvidence: jest.Mock, metrics?: { setCacheEntries: jest.Mock }) =>
    new QueryService(
      {} as Logger,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { fetchTransactionEvidence } as any,
      {} as any,
      {} as any,
      {} as any,
      metrics as any,
    );

  const evidence = (txHash: string) => ({
    txHash,
    redeemers: [{ type: 'spend', index: 0, data: 'd87980' }],
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces concurrent lookups for the same transaction', async () => {
    let resolveEvidence!: (value: ReturnType<typeof evidence>) => void;
    const fetchTransactionEvidence = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveEvidence = resolve;
      }),
    );
    const service = makeService(fetchTransactionEvidence);
    const getTransactionRedeemers = (service as any).getTransactionRedeemers.bind(service);

    const first = getTransactionRedeemers('ABC');
    const second = getTransactionRedeemers('abc');
    resolveEvidence(evidence('abc'));

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ type: 'spend', index: 0n, data: 'd87980' }],
      [{ type: 'spend', index: 0n, data: 'd87980' }],
    ]);
    expect(fetchTransactionEvidence).toHaveBeenCalledTimes(1);
  });

  it('shares cached transaction evidence with redeemer decoding', async () => {
    const txEvidence = evidence('abc');
    const fetchTransactionEvidence = jest.fn().mockResolvedValue(txEvidence);
    const service = makeService(fetchTransactionEvidence);
    const getTransactionEvidence = (service as any).getTransactionEvidence.bind(service);
    const getTransactionRedeemers = (service as any).getTransactionRedeemers.bind(service);

    await expect(getTransactionEvidence('ABC')).resolves.toBe(txEvidence);
    await expect(getTransactionRedeemers('abc')).resolves.toEqual([
      { type: 'spend', index: 0n, data: 'd87980' },
    ]);
    expect(fetchTransactionEvidence).toHaveBeenCalledTimes(1);
  });

  it('removes failed lookups so a later request can retry', async () => {
    const fetchTransactionEvidence = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary node failure'))
      .mockResolvedValueOnce(evidence('abc'));
    const service = makeService(fetchTransactionEvidence);
    const getTransactionRedeemers = (service as any).getTransactionRedeemers.bind(service);

    await expect(getTransactionRedeemers('abc')).rejects.toThrow('temporary node failure');
    await expect(getTransactionRedeemers('abc')).resolves.toEqual([{ type: 'spend', index: 0n, data: 'd87980' }]);
    expect(fetchTransactionEvidence).toHaveBeenCalledTimes(2);
  });

  it('reloads transaction redeemers after their TTL expires', async () => {
    jest.useFakeTimers();
    const fetchTransactionEvidence = jest.fn((txHash: string) => Promise.resolve(evidence(txHash)));
    const service = makeService(fetchTransactionEvidence);
    const getTransactionRedeemers = (service as any).getTransactionRedeemers.bind(service);

    await expect(getTransactionRedeemers('abc')).resolves.toBeDefined();
    await jest.advanceTimersByTimeAsync(TX_REDEEMER_CACHE_TTL_MS);
    await expect(getTransactionRedeemers('abc')).resolves.toBeDefined();

    expect(fetchTransactionEvidence).toHaveBeenCalledTimes(2);
  });

  it('evicts least-recently-used transaction redeemers at the configured bound', async () => {
    const metrics = { setCacheEntries: jest.fn() };
    const fetchTransactionEvidence = jest.fn((txHash: string) => Promise.resolve(evidence(txHash)));
    const service = makeService(fetchTransactionEvidence, metrics);
    const getTransactionRedeemers = (service as any).getTransactionRedeemers.bind(service);

    for (let index = 0; index <= TX_REDEEMER_CACHE_MAX_ENTRIES; index += 1) {
      await getTransactionRedeemers(`tx-${index}`);
    }

    expect((service as any).txEvidenceCache.size).toBe(TX_REDEEMER_CACHE_MAX_ENTRIES);
    await getTransactionRedeemers('tx-0');
    expect(fetchTransactionEvidence).toHaveBeenCalledTimes(TX_REDEEMER_CACHE_MAX_ENTRIES + 2);
    expect(metrics.setCacheEntries).toHaveBeenLastCalledWith('tx_redeemers', TX_REDEEMER_CACHE_MAX_ENTRIES);
  });
});
