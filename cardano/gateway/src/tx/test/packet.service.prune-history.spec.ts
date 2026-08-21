import * as Lucid from '@lucid-evolution/lucid';
import { PacketService } from '../packet.service';
import { convertString2Hex } from '../../shared/helpers/hex';
import { packetCommitmentPath } from '../../shared/helpers/packet-keys';

const sequence = 7n;
const proofHeight = { revisionNumber: 0n, revisionHeight: 40n };

function createService(ordering: 'Unordered' | 'Ordered' = 'Unordered') {
  const deployment = {
    validators: {
      spendChannel: {
        refValidator: {
          prune_packet_history: { scriptHash: 'prune-policy' },
        },
      },
      verifyProof: { scriptHash: 'verify-policy' },
    },
  };
  const channelDatum = {
    port: convertString2Hex('transfer'),
    token: { policyId: 'channel-policy', name: 'channel-name' },
    state: {
      channel: {
        state: 'Open',
        ordering,
        counterparty: {
          port_id: convertString2Hex('transfer'),
          channel_id: convertString2Hex('channel-44'),
        },
        connection_hops: [convertString2Hex('connection-0')],
        version: convertString2Hex('ics20-1'),
      },
      next_sequence_send: 1n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
      packet_commitment: new Map(),
      packet_receipt: new Map([[sequence, '']]),
      packet_acknowledgement: new Map([[sequence, 'aa']]),
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 10n },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 30n },
    },
  };
  const connectionDatum = {
    state: {
      client_id: convertString2Hex('07-tendermint-0'),
      delay_period: 0n,
      counterparty: { prefix: { key_prefix: convertString2Hex('ibc') } },
    },
  };
  const consensusHeight = { ...proofHeight };
  const clientDatum = {
    state: {
      clientState: {
        chainId: convertString2Hex('counterparty'),
        trustLevel: { numerator: 1n, denominator: 3n },
        trustingPeriod: 100n,
        unbondingPeriod: 200n,
        maxClockDrift: 5n,
        frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
        latestHeight: proofHeight,
        proofSpecs: [],
      },
      consensusStates: new Map([
        [consensusHeight, { timestamp: 10n, next_validators_hash: 'aa', root: { hash: 'bb' } }],
      ]),
      processedTimes: new Map([[consensusHeight, 0n]]),
      processedHeights: new Map([[consensusHeight, 0n]]),
    },
  };
  const channelUtxo = { txHash: 'channel', outputIndex: 0, datum: 'channel-datum', assets: {} };
  const connectionUtxo = { txHash: 'connection', outputIndex: 0, datum: 'connection-datum', assets: {} };
  const clientUtxo = { txHash: 'client', outputIndex: 0, datum: 'client-datum', assets: {} };
  const unsignedTx = { tag: 'unsigned-prune' };
  const lucidService: any = {
    getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy', 'channel-name']),
    getConnectionTokenUnit: jest.fn().mockReturnValue(['connection-policy', 'connection-name']),
    getClientTokenUnit: jest.fn().mockReturnValue('client-unit'),
    findUtxoByUnit: jest
      .fn()
      .mockResolvedValueOnce(channelUtxo)
      .mockResolvedValueOnce(connectionUtxo)
      .mockResolvedValueOnce(clientUtxo),
    decodeDatum: jest.fn().mockImplementation(async (_datum: string, type: string) => {
      if (type === 'channel') return channelDatum;
      if (type === 'connection') return connectionDatum;
      if (type === 'client') return clientDatum;
      throw new Error(`unexpected datum type ${type}`);
    }),
    encode: jest.fn().mockImplementation(async (_value: unknown, type: string) => `encoded-${type}`),
    createUnsignedPrunePacketHistoryTx: jest.fn().mockReturnValue(unsignedTx),
    LucidImporter: Lucid,
  };
  const logger: any = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new PacketService(
    logger,
    { get: jest.fn().mockImplementation((key: string) => (key === 'deployment' ? deployment : undefined)) } as any,
    lucidService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(service as any, 'buildHostStateUpdateForPrunePacketHistory').mockResolvedValue({
    hostStateUtxo: { txHash: 'host', outputIndex: 0, datum: 'host-datum', assets: {} },
    encodedHostStateRedeemer: 'encoded-host-redeemer',
    encodedUpdatedHostStateDatum: 'encoded-host-datum',
    newRoot: 'new-root',
    commit: jest.fn(),
  });

  return { service, lucidService, channelDatum, unsignedTx };
}

describe('PacketService packet-history prune builder', () => {
  it('binds the sequence, counterparty commitment path, map deletion, and root update', async () => {
    const { service, lucidService, channelDatum, unsignedTx } = createService();

    const result = await service.buildUnsignedPrunePacketHistoryTx({
      signer: 'addr_test1signer',
      portId: 'transfer',
      channelId: 'channel-7',
      sequence,
      proofCommitmentAbsence: { proofs: [] },
      proofHeight,
    });

    expect(result.unsignedTx).toBe(unsignedTx);
    expect(result.pendingTreeUpdate.expectedNewRoot).toBe('new-root');
    expect((service as any).buildHostStateUpdateForPrunePacketHistory).toHaveBeenCalledWith(
      channelDatum,
      'channel-7',
      sequence,
    );

    const spendRedeemer = lucidService.encode.mock.calls.find((call: unknown[]) => call[1] === 'spendChannelRedeemer')[0];
    expect(spendRedeemer).toEqual({
      PrunePacketHistory: {
        sequence,
        proof_commitment_absence: { proofs: [] },
        proof_height: proofHeight,
      },
    });
    const updatedDatum = lucidService.encode.mock.calls.find((call: unknown[]) => call[1] === 'channel')[0];
    expect(updatedDatum.state.packet_receipt.has(sequence)).toBe(false);
    expect(updatedDatum.state.packet_acknowledgement.has(sequence)).toBe(false);
    expect(updatedDatum.state.minimum_receive_proof_height).toEqual(proofHeight);
    expect(updatedDatum.state.maximum_receive_proof_height).toEqual({
      revisionNumber: 0n,
      revisionHeight: 30n,
    });

    const txDto = lucidService.createUnsignedPrunePacketHistoryTx.mock.calls[0][0];
    expect(txDto.encodedVerifyProofRedeemer).toContain(
      convertString2Hex(packetCommitmentPath('transfer', 'channel-44', sequence)),
    );
    expect(txDto).toMatchObject({
      prunePacketHistoryPolicyId: 'prune-policy',
      verifyProofPolicyId: 'verify-policy',
      channelToken: { policyId: 'channel-policy', name: 'channel-name' },
    });
  });

  it('rejects an absence proof below the receive high-water mark before loading proof context', async () => {
    const { service, lucidService } = createService();

    await expect(
      service.buildUnsignedPrunePacketHistoryTx({
        signer: 'addr_test1signer',
        portId: 'transfer',
        channelId: 'channel-7',
        sequence,
        proofCommitmentAbsence: { proofs: [] },
        proofHeight: { revisionNumber: 0n, revisionHeight: 29n },
      }),
    ).rejects.toThrow('below the channel receive high-water mark');
    expect(lucidService.findUtxoByUnit).toHaveBeenCalledTimes(1);
    expect(lucidService.createUnsignedPrunePacketHistoryTx).not.toHaveBeenCalled();
  });

  it('prunes only acknowledgements for ordered channels', async () => {
    const { service, lucidService, channelDatum } = createService('Ordered');
    channelDatum.state.packet_receipt = new Map();

    await service.buildUnsignedPrunePacketHistoryTx({
      signer: 'addr_test1signer',
      portId: 'transfer',
      channelId: 'channel-7',
      sequence,
      proofCommitmentAbsence: { proofs: [] },
      proofHeight,
    });

    const updatedDatum = lucidService.encode.mock.calls.find(
      (call: unknown[]) => call[1] === 'channel',
    )[0];
    expect(updatedDatum.state.packet_receipt).toEqual(new Map());
    expect(updatedDatum.state.packet_acknowledgement.has(sequence)).toBe(false);
  });
});
