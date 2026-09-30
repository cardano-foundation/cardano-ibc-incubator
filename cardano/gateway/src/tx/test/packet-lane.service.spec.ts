import { PacketLaneService } from '../packet-lane.service';
import {
  buildPacketSendBatch,
  buildPacketBalanceCompaction,
  usableTransferIntent,
} from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({
  buildPacketSendBatch: jest.fn(),
  buildPacketBalanceCompaction: jest.fn(),
  usableTransferIntent: jest.fn(),
}));
jest.mock('../../query/services/packet-state.service', () => ({ PacketStateService: class {} }));

class Datum {
  index = 0;
  fields: unknown[];
  constructor(port = 'transfer', channel = 'channel-0') {
    this.fields = [port, channel, 'owner', {}, 1n];
  }
}

describe('default funded packet batches', () => {
  let service: PacketLaneService;
  let pending: any[];
  let history: any;
  let events: any;
  let complete: jest.SpyInstance;
  const request = { signer: 'batcher', port_id: 'transfer', channel_id: 'channel-0', intent_tx_hash: 'bb' };
  beforeEach(() => {
    jest.clearAllMocks();
    pending = ['aa', 'bb', 'cc'].map((txHash) => ({ txHash, outputIndex: 0, datum: new Datum() }));
    history = { findIntentSpendingTransaction: jest.fn().mockResolvedValue(null) };
    events = { events: jest.fn().mockResolvedValue([]) };
    const lucid = {
      LucidImporter: { Data: { from: (data: any) => data }, Constr: Datum, fromText: (text: string) => text },
      lucid: { utxosAt: jest.fn(async () => pending) },
    };
    service = new PacketLaneService(
      { getOrThrow: () => ({ packetState: {} }) } as any,
      lucid as any,
      {} as any,
      {} as any,
      events,
      history,
    );
    jest.spyOn(service, 'deployment').mockResolvedValue({ guardAddress: 'guard' } as any);
    jest.spyOn(service as any, 'initialize').mockResolvedValue(undefined);
    complete = jest.spyOn(service as any, 'complete').mockImplementation(async (_signer, _name, build: any) => {
      await build(0, 1000);
      return { type_url: '', value: new Uint8Array([1]) };
    });
    jest.mocked(usableTransferIntent).mockReturnValue(true);
    jest.mocked(buildPacketSendBatch).mockResolvedValue({ tx: {} } as any);
  });

  it('builds evaluated accounting maintenance for the requested lane pair', async () => {
    jest.mocked(buildPacketBalanceCompaction).mockResolvedValue({ tx: {} } as any);
    const response = await service.compactBalances({
      signer: 'operator',
      port_id: 'transfer',
      channel_id: 'channel-0',
      left_lane: 1,
      right_lane: 2,
      left_denoms: ['asset-to-return'],
    });
    expect(response.unsigned_tx.value).toEqual(new Uint8Array([1]));
    expect(buildPacketBalanceCompaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, 2, [
      'asset-to-return',
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('accepts omitted protobuf defaults for lane zero and automatic compaction', async () => {
    jest.mocked(buildPacketBalanceCompaction).mockResolvedValue({ tx: {} } as any);
    await service.compactBalances({
      signer: 'operator',
      port_id: 'transfer',
      channel_id: 'channel-0',
      right_lane: 1,
    } as any);
    expect(buildPacketBalanceCompaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0, 1, undefined);
  });

  it('rejects maintenance outside the transfer application', async () => {
    await expect(
      service.compactBalances({
        signer: 'operator',
        port_id: 'other',
        channel_id: 'channel-0',
        left_lane: 1,
        right_lane: 2,
        left_denoms: [],
      }),
    ).rejects.toThrow('Invalid packet accounting');
    expect(complete).not.toHaveBeenCalled();
  });

  it('prioritizes the requested funded input and bounds the batch to two', async () => {
    const response = await service.batch(request);
    expect(response.stage).toBe('send');
    expect(response.intent_tx_hashes).toEqual(['bb', 'aa']);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rebuilds one request when two requests exceed evaluation limits', async () => {
    jest.mocked(buildPacketSendBatch).mockRejectedValueOnce(new Error('execution budget exceeded'));
    const response = await service.batch(request);
    expect(response.intent_tx_hashes).toEqual(['bb']);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not let a malformed unrelated intent block a funded request', async () => {
    pending[0].datum = { invalid: true };
    const response = await service.batch(request);
    expect(response.intent_tx_hashes).toEqual(['bb', 'cc']);
  });

  it('ignores a datum with malformed port and channel fields', async () => {
    pending[0].datum.fields[0] = { malformed: true };
    const response = await service.batch(request);
    expect(response.intent_tx_hashes).toEqual(['bb', 'cc']);
  });

  it('requires canonical spending evidence when an intent disappears', async () => {
    pending = [];
    await expect(service.batch(request)).rejects.toThrow('not available in canonical indexed state');
    expect(complete).not.toHaveBeenCalled();
  });

  it('reports the consuming batch so competing builders can recover its events', async () => {
    pending = [];
    history.findIntentSpendingTransaction.mockResolvedValue({ txHash: 'consuming' });
    events.events.mockResolvedValue([{ type: 'send_packet' }]);
    await expect(service.batch(request)).resolves.toMatchObject({ stage: 'included', included_tx_hash: 'consuming' });
  });

  it('does not confuse cancellation with a completed transfer', async () => {
    pending = [];
    history.findIntentSpendingTransaction.mockResolvedValue({ txHash: 'cancellation' });
    await expect(service.batch(request)).rejects.toThrow('cancelled without sending');
  });
});
