import { PacketLaneService } from '../packet-lane.service';
import {
  acknowledgementField,
  buildLiquidityRetirement,
  FragmentedPacketLiquidityError,
  buildPacketRejection,
  buildPacketTimeout,
  selectPacketLiquidity,
} from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => {
  const actual = jest.requireActual('@cardano-ibc/tx-builder-runtime/packetLaneTransactions');
  return {
    acknowledgementField: actual.acknowledgementField,
    buildPacketRejection: jest.fn(),
    buildPacketTimeout: jest.fn(),
    buildLiquidityRetirement: jest.fn(),
    FragmentedPacketLiquidityError: actual.FragmentedPacketLiquidityError,
    selectPacketLiquidity: jest.fn(),
    record: jest.fn(),
  };
});
jest.mock('../../query/services/packet-state.service', () => ({ PacketStateService: class {} }));

it('selects refund liquidity from unreserved inputs after entering the completion scope', async () => {
  const busy = { txHash: 'busy', outputIndex: 0 } as any;
  const alternative = { txHash: 'alternative', outputIndex: 0 } as any;
  const lane = { txHash: 'lane', outputIndex: 0 } as any;
  const deployment = { client: {}, batchAddress: 'batch' } as any;
  const lucid = {
    lucid: { utxosAt: jest.fn().mockResolvedValue([busy, alternative]) },
    resolveClientAtHeights: jest.fn().mockResolvedValue({ clientUtxo: {}, historyWitnesses: [] }),
  };
  const service = new PacketLaneService({} as any, lucid as any, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(service, 'deployment').mockResolvedValue(deployment);
  jest.spyOn(service as any, 'packet').mockReturnValue({});
  jest.spyOn(service as any, 'proof').mockReturnValue({});
  jest.mocked(selectPacketLiquidity).mockImplementation((inputs) => inputs);
  jest.mocked(buildPacketTimeout).mockResolvedValue({ tx: {}, input: lane } as any);
  jest.spyOn(service as any, 'complete').mockImplementation(async (_signer, _name, build: any) => {
    // Candidate discovery must happen after the runner refreshed reservations.
    expect(lucid.lucid.utxosAt).not.toHaveBeenCalled();
    const built = await build(0, 1000, (inputs: any[]) => inputs.filter((input) => input !== busy));
    expect(built.inputs).toEqual([lane, alternative]);
    return { value: new Uint8Array([1]) };
  });
  await service.settle(
    {
      signer: 'operator',
      packet: {
        source_port: 'transfer',
        source_channel: 'channel-0',
        sequence: 1n,
        timeout_height: { revision_number: 0n, revision_height: 0n },
        timeout_timestamp: 0n,
        data: Buffer.from(JSON.stringify({ denom: '6c6f76656c616365', amount: '20' })),
      },
      proof_height: { revision_number: 0n, revision_height: 1n },
    } as any,
    'timeout',
  );
  expect(selectPacketLiquidity).toHaveBeenCalledWith(
    [alternative],
    deployment,
    'transfer',
    'channel-0',
    '6c6f76656c616365',
    20n,
    1n,
  );
});

describe('fragmented settlement', () => {
  beforeEach(() => jest.clearAllMocks());

  function fixture() {
    const deposits = Array.from({ length: 5 }, (_, outputIndex) => ({ txHash: 'deposit', outputIndex })) as any[];
    const lucid = {
      lucid: { utxosAt: jest.fn().mockResolvedValue(deposits) },
      resolveClientAtHeights: jest.fn().mockResolvedValue({ clientUtxo: {}, historyWitnesses: [] }),
    };
    const service = new PacketLaneService({} as any, lucid as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'deployment').mockResolvedValue({ batchAddress: 'batch' } as any);
    jest.spyOn(service as any, 'packet').mockReturnValue({});
    jest.spyOn(service as any, 'proof').mockReturnValue({});
    jest.spyOn(service as any, 'initialize').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'complete').mockImplementation(async (_signer, _name, build: any) => {
      const built = await build(0, 1000, (inputs: any[]) => inputs);
      expect(built.inputs).toEqual(deposits);
      return { type_url: '', value: new Uint8Array([1]) };
    });
    const request = {
      signer: 'operator',
      packet: {
        source_port: 'transfer',
        source_channel: 'channel-0',
        destination_port: 'transfer',
        destination_channel: 'channel-7',
        sequence: 1n,
        timeout_height: { revision_number: 0n, revision_height: 0n },
        timeout_timestamp: 0n,
        data: Buffer.from(JSON.stringify({ denom: '6c6f76656c616365', amount: '60' })),
      },
      proof_height: { revision_number: 0n, revision_height: 1n },
    } as any;
    return { service, deposits, request };
  }

  it.each(['timeout', 'receive', 'acknowledge'] as const)(
    'returns bounded maintenance for a fragmented %s payout',
    async (kind) => {
      const { service, deposits, request } = fixture();
      if (kind === 'receive')
        request.packet.data = Buffer.from(
          JSON.stringify({ denom: 'transfer/channel-0/6c6f76656c616365', amount: '60' }),
        );
      if (kind === 'acknowledge') request.acknowledgement = Buffer.from(JSON.stringify({ error: 'rejected' }));
      jest.mocked(selectPacketLiquidity).mockImplementation(() => {
        throw new FragmentedPacketLiquidityError(deposits, 60n, 60n);
      });
      jest.mocked(buildLiquidityRetirement).mockResolvedValue({} as any);
      const result = await service.settle(request, kind);
      expect(result.unsigned_tx.type_url).toBe('/ibc.cardano.v1.ConsolidatePacketLiquidity');
      expect(buildLiquidityRetirement).toHaveBeenCalledWith(expect.anything(), expect.anything(), deposits, true);
      expect(buildPacketTimeout).not.toHaveBeenCalled();
    },
  );

  it('propagates a true shortfall without constructing maintenance', async () => {
    const { service, request } = fixture();
    const error = new Error('Insufficient total packet liquidity');
    jest.mocked(selectPacketLiquidity).mockImplementation(() => {
      throw error;
    });
    await expect(service.settle(request, 'timeout')).rejects.toBe(error);
    expect(buildLiquidityRetirement).not.toHaveBeenCalled();
  });
});

describe('error acknowledgement settlement', () => {
  beforeEach(() => jest.clearAllMocks());

  function settle(acknowledgement: string) {
    const lucid = {
      lucid: { utxosAt: jest.fn().mockResolvedValue([]) },
      resolveClientAtHeights: jest.fn().mockResolvedValue({ clientUtxo: {}, historyWitnesses: [] }),
    };
    const service = new PacketLaneService({} as any, lucid as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'deployment').mockResolvedValue({ batchAddress: 'batch' } as any);
    jest.spyOn(service as any, 'packet').mockReturnValue({});
    jest.spyOn(service as any, 'proof').mockReturnValue({});
    const complete = jest.spyOn(service as any, 'complete').mockImplementation(async (_signer, _name, build: any) => {
      await build(0, 1000, (inputs: any[]) => inputs);
      return { value: new Uint8Array([1]) };
    });
    jest.mocked(selectPacketLiquidity).mockImplementation((inputs) => inputs);
    jest.mocked(buildPacketRejection).mockResolvedValue({ tx: {}, input: {} } as any);
    const settled = service.settle(
      {
        signer: 'operator',
        packet: {
          source_port: 'transfer',
          source_channel: 'channel-0',
          sequence: 1n,
          timeout_height: { revision_number: 0n, revision_height: 0n },
          timeout_timestamp: 0n,
          data: Buffer.from(JSON.stringify({ denom: '6c6f76656c616365', amount: '20' })),
        },
        proof_height: { revision_number: 0n, revision_height: 1n },
        acknowledgement: Buffer.from(acknowledgement),
      } as any,
      'acknowledge',
    );
    return { settled, complete };
  }

  it('refunds with the counterparty acknowledgement bytes, escapes included', async () => {
    // Go's encoding/json writes < and > as \u003c and \u003e.
    const acknowledgement = '{"error":"invalid receiver \\u003cbob\\u003e"}';
    await settle(acknowledgement).settled;
    const bytes = jest.mocked(buildPacketRejection).mock.calls[0][6];
    expect(Buffer.from(bytes).toString('utf8')).toBe(acknowledgement);
    expect(Buffer.from(acknowledgementField(bytes, 'error'), 'hex').toString('utf8')).toBe(
      'invalid receiver \\u003cbob\\u003e',
    );
  });

  it.each(['{"error": "rejected"}', '{"error":"rejected","result":"AQ=="}'])(
    'rejects the non-compact envelope %s before building',
    async (acknowledgement) => {
      const { settled, complete } = settle(acknowledgement);
      await expect(settled).rejects.toThrow('Acknowledgement must be compact {"error":"..."} JSON');
      expect(complete).not.toHaveBeenCalled();
      expect(selectPacketLiquidity).not.toHaveBeenCalled();
      expect(buildPacketRejection).not.toHaveBeenCalled();
    },
  );
});
