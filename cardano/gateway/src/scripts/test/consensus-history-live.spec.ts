import type { HistorySource, HistoryTransaction } from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import { checkpointBarrierSource, liveTestHeight, requireEmptyPublicTreeCache, requireOlderHeight, requirePruneChains, requireSameHistoryDeployment, runLiveHistoryTest } from './consensus-history-live';

describe('live consensus history acceptance arguments', () => {
  it('keeps exact revision and height without numeric rounding', () => {
    expect(liveTestHeight('1-9007199254740993')).toEqual({ revisionNumber: 1n, revisionHeight: 9007199254740993n });
  });

  it.each(['1-0', '01-2', '1-02', '-1-2', '1', '1-2 ', '1-2-3'])('rejects ambiguous proof height %s', (value) => {
    expect(() => liveTestHeight(value)).toThrow('canonical');
  });

  it('requires a historical checkpoint rather than quietly testing the current tip', () => {
    expect(() => requireOlderHeight(liveTestHeight('1-2'), liveTestHeight('1-3'))).not.toThrow();
    for (const value of ['1-3', '1-4', '0-2', '2-2']) {
      expect(() => requireOlderHeight(liveTestHeight(value), liveTestHeight('1-3'))).toThrow('older checkpoint');
    }
  });

  it('does not mistake a disabled startup cache for an empty historical proof cache', () => {
    expect(() => requireEmptyPublicTreeCache('0')).not.toThrow();
    expect(() => requireEmptyPublicTreeCache(0)).not.toThrow();
    expect(() => requireEmptyPublicTreeCache('1')).toThrow('empty ibc_state_tree_cache');
  });

  it('binds a resumed cache to the exact client token and address, not just its numeric ID', () => {
    const token = { policyId: '11'.repeat(28), name: '22'.repeat(24) + '30' };
    const saved = { clientToken: token, stateAddress: 'client-script-a' };
    expect(() => requireSameHistoryDeployment(saved, token, saved.stateAddress)).not.toThrow();
    expect(() => requireSameHistoryDeployment(saved, { ...token, policyId: '33'.repeat(28) }, saved.stateAddress)).toThrow('another client token');
    expect(() => requireSameHistoryDeployment(saved, { ...token, name: '44'.repeat(24) + '30' }, saved.stateAddress)).toThrow('another client token');
    expect(() => requireSameHistoryDeployment(saved, token, 'client-script-b')).toThrow('another client address');
  });

  it('binds prune chain arguments before submitting a transaction', () => {
    const chain = Buffer.from('v8-classic-1').toString('hex');
    expect(() => requirePruneChains('v8-classic-1', 'cardano-devnet', chain, 'cardano-devnet')).not.toThrow();
    expect(() => requirePruneChains('another-cosmos-1', 'cardano-devnet', chain, 'cardano-devnet')).toThrow('source chain');
    expect(() => requirePruneChains('v8-classic-1', 'cardano-preprod', chain, 'cardano-devnet')).toThrow('destination chain');
  });

  it('prints help without initializing Gateway or touching a database', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runLiveHistoryTest(['--help']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('rebuilt from live Yaci/Kupo data'));
    } finally { log.mockRestore(); }
  });

  it('requires a client before attempting any live operation', async () => {
    await expect(runLiveHistoryTest([])).rejects.toThrow('--client-id is required');
  });

  const args = ['--client-id', '07-tendermint-0', '--proof-height', '1-2', '--report-dir', '/unused-live-report'];
  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('rejects an invalid pause count %s before live operations', async (count) => {
    await expect(runLiveHistoryTest([...args, `--pause-after-checkpoints=${count}`])).rejects.toThrow('positive safe integer');
  });

  it.each([['--resume-history-cache', '/unused-history'], ['--prune']])('requires the pause test to be a fresh audit-only run: %s', async (...flags) => {
    await expect(runLiveHistoryTest([...args, '--pause-after-checkpoints', '25', ...flags])).rejects.toThrow('fresh audit-only run');
  });
});

describe('live history checkpoint scheduling', () => {
  const transaction: HistoryTransaction = {
    txHash: '11'.repeat(32), blockHash: '22'.repeat(32), blockHeight: 10,
    slot: 100, transactionIndex: 0, cbor: '80',
  };

  it('leaves the actual evidence and resume cursor unchanged and pauses only after consumption', async () => {
    let release!: () => void;
    let reached!: () => void;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const barrierReached = new Promise<void>((resolve) => { reached = resolve; });
    const currentState = jest.fn(async () => ({ txHash: transaction.txHash, outputIndex: 0, address: 'test', assets: { lovelace: 1n } }));
    const transactions = jest.fn(async function* () { yield transaction; });
    const source: HistorySource = { currentState, transactions };
    const hook = jest.fn(async (evidence: HistoryTransaction) => {
      expect(evidence).toBe(transaction);
      reached();
      await pause;
    });
    const wrapped = checkpointBarrierSource(source, hook);
    expect(await wrapped.currentState()).toEqual(await source.currentState());
    const iterator = wrapped.transactions(transaction)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: transaction });
    expect(transactions).toHaveBeenCalledWith(transaction);
    expect(hook).not.toHaveBeenCalled();
    const next = iterator.next();
    await barrierReached;
    expect(hook).toHaveBeenCalledTimes(1);
    release();
    expect(await next).toEqual({ done: true, value: undefined });
  });

  it('does not turn a real source failure into successful completion', async () => {
    const failure = new Error('missing raw transaction CBOR');
    const source: HistorySource = {
      currentState: jest.fn(),
      async *transactions() { throw failure; },
    };
    const hook = jest.fn();
    const iterator = checkpointBarrierSource(source, hook).transactions()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(failure);
    expect(hook).not.toHaveBeenCalled();
  });
});
