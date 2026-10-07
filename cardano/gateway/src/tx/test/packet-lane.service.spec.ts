import { PacketInputsBusyError } from '../tx-input-reservations';
import { PacketLaneService } from '../packet-lane.service';
import {
  PacketLaneAccountingCapacityError,
  buildPacketSendBatch,
  buildTransferIntentCancellation,
  buildPacketBalanceCompaction,
  usableTransferIntent,
} from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({
  PacketLaneAccountingCapacityError: jest.requireActual('@cardano-ibc/tx-builder-runtime/packetLaneTransactions')
    .PacketLaneAccountingCapacityError,
  buildPacketSendBatch: jest.fn(),
  buildTransferIntentCancellation: jest.fn(),
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

  it('cancels an expired funded request without trying to send it', async () => {
    const hash = 'ab'.repeat(32);
    pending = [{ txHash: hash, outputIndex: 0, datum: new Datum() }];
    jest.mocked(usableTransferIntent).mockReturnValue(false);
    const tx = {} as any;
    jest.mocked(buildTransferIntentCancellation).mockResolvedValue(tx);
    await expect(service.cancelIntent('channel-0', hash, 'owner')).resolves.toEqual({
      unsigned_tx: { type_url: '', value: new Uint8Array([1]) },
    });
    expect(buildTransferIntentCancellation).toHaveBeenCalledWith(expect.anything(), expect.anything(), pending[0]);
    expect(buildPacketSendBatch).not.toHaveBeenCalled();
  });

  it('propagates owner authorization failure and does not build a send', async () => {
    const hash = 'ab'.repeat(32);
    pending = [{ txHash: hash, outputIndex: 0, datum: new Datum() }];
    jest.mocked(buildTransferIntentCancellation).mockRejectedValueOnce(new Error('Only the intent owner can cancel'));
    await expect(service.cancelIntent('channel-0', hash, 'stranger')).rejects.toThrow('Only the intent owner');
    expect(buildPacketSendBatch).not.toHaveBeenCalled();
  });

  it('rejects a disappeared request and a request on another channel', async () => {
    const hash = 'ab'.repeat(32);
    pending = [];
    await expect(service.cancelIntent('channel-0', hash, 'owner')).rejects.toThrow('no longer pending');
    pending = [{ txHash: hash, outputIndex: 0, datum: new Datum('transfer', 'channel-1') }];
    await expect(service.cancelIntent('channel-0', hash, 'owner')).rejects.toThrow('no longer pending');
    expect(buildTransferIntentCancellation).not.toHaveBeenCalled();
  });

  it('requires a full output reference when one transaction funded several requests', async () => {
    const hash = 'ab'.repeat(32);
    pending = [0, 1].map((outputIndex) => ({ txHash: hash, outputIndex, datum: new Datum() }));
    await expect(service.cancelIntent('channel-0', hash, 'owner')).rejects.toThrow('Specify the intent output index');
    jest.mocked(buildTransferIntentCancellation).mockResolvedValue({} as any);
    await service.cancelIntent('channel-0', hash, 'owner', 1);
    expect(buildTransferIntentCancellation).toHaveBeenCalledWith(expect.anything(), expect.anything(), pending[1]);
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
    events.events.mockResolvedValue([
      {
        type: 'send_packet',
        event_attribute: [
          { key: 'intent_tx_hash', value: request.intent_tx_hash },
          { key: 'packet_src_port', value: 'transfer' },
          { key: 'packet_src_channel', value: 'channel-0' },
          { key: 'packet_sequence', value: '1' },
        ],
      },
    ]);
    await expect(service.batch(request)).resolves.toMatchObject({ stage: 'included', included_tx_hash: 'consuming' });
  });

  it.each([
    ['intent_tx_hash', 'other'],
    ['packet_src_channel', 'channel-1'],
    ['packet_src_port', 'other'],
    ['packet_sequence', ''],
  ])('rejects unrelated or incomplete send evidence for %s in both recovery paths', async (key, value) => {
    const hash = 'ab'.repeat(32);
    pending = [];
    history.findIntentSpendingTransaction.mockResolvedValue({ txHash: 'consuming' });
    const attributes = {
      intent_tx_hash: hash,
      packet_src_port: 'transfer',
      packet_src_channel: 'channel-0',
      packet_sequence: '1',
      [key]: value,
    };
    events.events.mockResolvedValue([
      { type: 'send_packet', event_attribute: Object.entries(attributes).map(([key, value]) => ({ key, value })) },
    ]);
    await expect(service.batch({ ...request, intent_tx_hash: hash })).rejects.toThrow('cancelled without sending');
    await expect(service.intentStatus('channel-0', hash)).resolves.toEqual({ stage: 'cancelled' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not confuse cancellation with a completed transfer', async () => {
    pending = [];
    history.findIntentSpendingTransaction.mockResolvedValue({ txHash: 'cancellation' });
    await expect(service.batch(request)).rejects.toThrow('cancelled without sending');
  });
  it('tracks only the packet assigned to the requested funded intent', async () => {
    const hash = 'ab'.repeat(32);
    pending = [];
    history.findIntentSpendingTransaction.mockResolvedValue({ txHash: 'batch' });
    events.events.mockResolvedValue([
      {
        type: 'send_packet',
        event_attribute: [
          { key: 'intent_tx_hash', value: 'other' },
          { key: 'packet_sequence', value: '1' },
        ],
      },
      {
        type: 'send_packet',
        event_attribute: [
          { key: 'intent_tx_hash', value: hash },
          { key: 'packet_src_port', value: 'transfer' },
          { key: 'packet_src_channel', value: 'channel-0' },
          { key: 'packet_sequence', value: '2' },
        ],
      },
    ]);
    await expect(service.intentStatus('channel-0', hash)).resolves.toEqual({
      stage: 'sent',
      packetTxHash: 'batch',
      packetSequence: '2',
    });
    pending = [{ txHash: hash }];
    await expect(service.intentStatus('channel-0', hash)).resolves.toEqual({ stage: 'funded' });
  });

  it('does not call intent funding or cancellation a sent packet', async () => {
    const hash = 'ab'.repeat(32);
    pending = [];
    await expect(service.intentStatus('channel-0', hash)).resolves.toEqual({ stage: 'pending' });
    pending = [{ txHash: hash }];
    await expect(service.intentStatus('channel-0', hash)).resolves.toEqual({ stage: 'funded' });
    pending = [];
    history.findIntentSpendingTransaction.mockResolvedValue({ txHash: 'cancel' });
    await expect(service.intentStatus('channel-0', hash)).resolves.toEqual({ stage: 'cancelled' });
  });
  it('discovers browser-funded requests without a user signer or intent hint', async () => {
    const response = await service.batch({ signer: 'relayer-wallet', port_id: 'transfer', channel_id: 'channel-0' });
    expect(response.intent_tx_hashes).toEqual(['aa', 'bb']);
    expect(complete).toHaveBeenCalledWith('relayer-wallet', 'packetBatch', expect.any(Function));
  });

  it('does not initialize idle channels and binds initialization to a funded request', async () => {
    pending = [];
    await expect(service.batch({ ...request, intent_tx_hash: undefined })).resolves.toEqual({
      stage: 'idle',
      intent_tx_hashes: [],
    });
    expect((service as any).initialize).not.toHaveBeenCalled();
    pending = [{ txHash: 'aa', datum: new Datum() }];
    jest.mocked((service as any).initialize).mockResolvedValue({ value: new Uint8Array([1]) });
    await expect(service.batch({ ...request, intent_tx_hash: undefined })).resolves.toMatchObject({
      stage: 'initialize',
      intent_tx_hashes: ['aa'],
    });
  });
  it('drains valid backlog behind a request that passes shape checks but fails script evaluation', async () => {
    jest.mocked(buildPacketSendBatch).mockImplementation(async (_lucid, _deployment, inputs) => {
      if (inputs.some((input) => input.txHash === 'aa'))
        throw new Error('script validation failed for unusable intent');
      return { tx: {} } as any;
    });
    const response = await service.batch({ ...request, intent_tx_hash: '' });
    expect(response.intent_tx_hashes).toEqual(['bb', 'cc']);
    expect(complete).toHaveBeenCalledTimes(3);
    pending = pending.filter((input) => !response.intent_tx_hashes.includes(input.txHash));
    await expect(service.batch({ ...request, intent_tx_hash: '' })).resolves.toMatchObject({ stage: 'idle' });
  });

  it('defers a new asset at accounting capacity and sends an already-accounted asset behind it', async () => {
    jest.mocked(buildPacketSendBatch).mockImplementation(async (_lucid, _deployment, inputs) => {
      if (inputs.some((input) => input.txHash === 'aa')) throw new PacketLaneAccountingCapacityError();
      return { tx: {} } as any;
    });
    const response = await service.batch({ ...request, intent_tx_hash: '' });
    expect(response.intent_tx_hashes).toEqual(['bb', 'cc']);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it('reports idle without building when every candidate fails complete datum validation', async () => {
    jest.mocked(usableTransferIntent).mockReturnValue(false);
    await expect(service.batch({ ...request, intent_tx_hash: '' })).resolves.toMatchObject({ stage: 'idle' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('bounds evaluation attempts and leaves unusable requests available for owner cancellation', async () => {
    pending = Array.from({ length: 12 }, (_, i) => ({
      txHash: `${i}`.padStart(2, '0'),
      outputIndex: 0,
      datum: new Datum(),
    }));
    jest.mocked(buildPacketSendBatch).mockRejectedValue(new Error('script validation failed'));
    await expect(service.batch({ ...request, intent_tx_hash: '' })).resolves.toMatchObject({ stage: 'idle' });
    expect(complete).toHaveBeenCalledTimes(16);
    expect(pending).toHaveLength(12);
  });
  it('backs off unavailable fee inputs without quarantining otherwise valid requests', async () => {
    jest.mocked(buildPacketSendBatch).mockRejectedValueOnce(new PacketInputsBusyError('reserved'));
    await expect(service.batch({ ...request, intent_tx_hash: '' })).rejects.toThrow('reserved');
    expect(complete).toHaveBeenCalledTimes(1);
    jest.mocked(buildPacketSendBatch).mockResolvedValue({ tx: {} } as any);
    expect((await service.batch({ ...request, intent_tx_hash: '' })).intent_tx_hashes).toEqual(['aa', 'bb']);
  });

  it('propagates infrastructure failures instead of treating healthy requests as unusable', async () => {
    jest.mocked(buildPacketSendBatch).mockRejectedValue(new Error('node connection refused'));
    await expect(service.batch({ ...request, intent_tx_hash: '' })).rejects.toThrow('node connection refused');
  });
  it('advances past a long unusable prefix even when earlier cooldowns expire', async () => {
    pending = Array.from({ length: 64 }, (_, i) => ({
      txHash: `bad-${i.toString().padStart(2, '0')}`,
      outputIndex: 0,
      datum: new Datum(),
    }));
    pending.push({ txHash: 'valid', outputIndex: 0, datum: new Datum() });
    jest.mocked(buildPacketSendBatch).mockImplementation(async (_lucid, _deployment, inputs) => {
      if (inputs.some((input) => input.txHash !== 'valid')) throw new Error('script validation failed');
      return { tx: {} } as any;
    });
    let now = 0;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      for (let pass = 0; pass < 8; pass++) {
        expect((await service.batch({ ...request, intent_tx_hash: '' })).stage).toBe('idle');
        now += 6_000;
      }
      expect((await service.batch({ ...request, intent_tx_hash: '' })).intent_tx_hashes).toEqual(['valid']);
    } finally {
      clock.mockRestore();
    }
  });
});
