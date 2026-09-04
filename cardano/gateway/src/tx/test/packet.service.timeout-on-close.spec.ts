import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { convertString2Hex } from '../../shared/helpers/hex';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { encodeVerifyProofRedeemer } from '../../shared/types/connection/verify-proof-redeemer';
import { TimeoutOnClosePacketOperator, TimeoutPacketOperator } from '../dto';
import { PacketService } from '../packet.service';

jest.mock('../../shared/types/connection/verify-proof-redeemer', () => {
  const actual = jest.requireActual('../../shared/types/connection/verify-proof-redeemer');
  return {
    ...actual,
    encodeVerifyProofRedeemer: jest.fn(() => 'encoded-verify-proof'),
  };
});

const proofHeight = { revisionNumber: 0n, revisionHeight: 40n };
const proofUnreceived = { proofs: [] };
const proofClose = { proofs: [] };

function createService(ordering: 'Ordered' | 'Unordered', state: 'Open' | 'Close' = 'Open') {
  const deployment = {
    validators: {
      spendChannel: {
        address: 'addr_test1spendchannel',
        refValidator: {
          timeout_packet: { scriptHash: 'timeout-policy' },
        },
      },
      verifyProof: { scriptHash: 'verify-policy' },
    },
    modules: {
      transfer: {
        address: 'addr_test1transfer',
        identifier: 'transfer-module-token',
      },
    },
  };
  const channelDatum = {
    port: convertString2Hex('transfer'),
    token: { policyId: 'channel-policy', name: 'channel-name' },
    state: {
      channel: {
        state,
        ordering,
        counterparty: {
          port_id: convertString2Hex('transfer'),
          channel_id: convertString2Hex('channel-9'),
        },
        connection_hops: [convertString2Hex('connection-0')],
        version: convertString2Hex('ics20-1'),
      },
      next_sequence_send: 3n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
      packet_commitment: new Map([[2n, 'commitment']]),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
    },
  };
  const connectionDatum = {
    state: {
      client_id: convertString2Hex('07-tendermint-0'),
      delay_period: 0n,
      counterparty: {
        connection_id: convertString2Hex('connection-7'),
        prefix: { key_prefix: convertString2Hex('ibc') },
      },
    },
  };
  const consensusHeight = { ...proofHeight };
  const clientDatum = {
    state: {
      clientState: { latestHeight: proofHeight, proofSpecs: [] },
      consensusStates: new Map([
        [
          consensusHeight,
          {
            timestamp: 10n,
            next_validators_hash: 'aa',
            root: { hash: 'bb' },
          },
        ],
      ]),
      processedTimes: new Map([[consensusHeight, 11n]]),
      processedHeights: new Map([[consensusHeight, 12n]]),
    },
  };
  const channelUtxo = { txHash: 'channel', outputIndex: 0, datum: 'channel-datum', assets: {} };
  const connectionUtxo = { txHash: 'connection', outputIndex: 0, datum: 'connection-datum', assets: {} };
  const clientUtxo = { txHash: 'client', outputIndex: 0, datum: 'client-datum', assets: {} };
  const transferModuleUtxo = { txHash: 'module', outputIndex: 0, datum: 'module-datum', assets: {} };
  const escrowUtxo = {
    txHash: 'escrow',
    outputIndex: 0,
    datum: 'escrow-datum',
    assets: { lovelace: 100n, 'escrow-shard': 1n },
  };
  const unsignedTx = { tag: 'unsigned-timeout' };
  const lucidService: any = {
    getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy', 'channel-name']),
    getConnectionTokenUnit: jest.fn().mockReturnValue(['connection-policy', 'connection-name']),
    getClientTokenUnit: jest.fn().mockReturnValue('client-token'),
    findUtxoByUnit: jest
      .fn()
      .mockResolvedValueOnce(channelUtxo)
      .mockResolvedValueOnce(connectionUtxo)
      .mockResolvedValueOnce(clientUtxo)
      .mockResolvedValueOnce(transferModuleUtxo),
    decodeDatum: jest.fn().mockImplementation(async (_datum: string, type: string) => {
      if (type === 'channel') return channelDatum;
      if (type === 'connection') return connectionDatum;
      if (type === 'client') return clientDatum;
      throw new Error(`unexpected datum type ${type}`);
    }),
    encode: jest.fn().mockImplementation(async (_value: unknown, type: string) => `encoded-${type}`),
    credentialToAddress: jest.fn().mockReturnValue('addr_test1sender'),
    createUnsignedTimeoutPacketUnescrowTx: jest.fn().mockReturnValue(unsignedTx),
    LucidImporter: {},
  };
  const service = new PacketService(
    { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger,
    { get: jest.fn().mockImplementation((key: string) => (key === 'deployment' ? deployment : undefined)) } as unknown as ConfigService,
    lucidService as LucidService,
    {} as DenomTraceService,
    {} as any,
    {} as any,
  );
  jest.spyOn(service as any, 'buildHostStateUpdateForHandlePacket').mockResolvedValue({
    hostStateUtxo: { txHash: 'host', outputIndex: 0, datum: 'host-datum', assets: {} },
    encodedHostStateRedeemer: 'encoded-host-redeemer',
    encodedUpdatedHostStateDatum: 'encoded-host-datum',
    newRoot: 'new-root',
    commit: jest.fn(),
  });
  jest.spyOn(service as any, 'findTransferEscrowShard').mockResolvedValue({
    kind: 'existing',
    utxo: escrowUtxo,
    encodedDatum: 'encoded-escrow-datum',
    shardTokenUnit: 'escrow-shard',
    transferModuleUtxo,
    registrySiblings: [],
  });

  const operator: TimeoutPacketOperator = {
    fungibleTokenPacketData: {
      denom: 'lovelace',
      amount: '7',
      sender: 'sender-key-hash',
      receiver: 'receiver',
      memo: '',
    },
    proofUnreceived,
    proofHeight,
    nextSequenceRecv: 1n,
    packet: {
      sequence: 2n,
      source_port: convertString2Hex('transfer'),
      source_channel: convertString2Hex('channel-0'),
      destination_port: convertString2Hex('transfer'),
      destination_channel: convertString2Hex('channel-9'),
      data: '00',
      timeout_height: { revisionNumber: 0n, revisionHeight: 1000n },
      timeout_timestamp: 0n,
    },
  };

  return { service, lucidService, channelDatum, operator, unsignedTx };
}

function encodedValue(lucidService: any, type: string): any {
  return lucidService.encode.mock.calls.find((call: unknown[]) => call[1] === type)?.[0];
}

describe('PacketService timeout builders', () => {
  const encodeProof = encodeVerifyProofRedeemer as jest.MockedFunction<typeof encodeVerifyProofRedeemer>;

  beforeEach(() => {
    encodeProof.mockClear();
  });

  it('closes an ordered channel and verifies nextSequenceRecv for an ordinary timeout', async () => {
    const { service, lucidService, channelDatum, operator, unsignedTx } = createService('Ordered');

    const result = await service.buildUnsignedTimeoutPacketTx(operator, 'addr_test1relayer');

    expect(result.unsignedTx).toBe(unsignedTx);
    const updatedDatum = encodedValue(lucidService, 'channel');
    expect(updatedDatum.state.channel.state).toBe('Close');
    expect(updatedDatum.state.packet_commitment.has(operator.packet.sequence)).toBe(false);
    expect((service as any).buildHostStateUpdateForHandlePacket).toHaveBeenCalledWith(
      channelDatum,
      updatedDatum,
      'channel-0',
    );
    expect(encodeProof.mock.calls[0][0]).toMatchObject({
      VerifyMembership: {
        value: '0000000000000001',
        path: {
          key_path: [convertString2Hex('ibc'), convertString2Hex('nextSequenceRecv/ports/transfer/channels/channel-9')],
        },
      },
    });
  });

  it('uses both memberships for ordered timeout on close and preserves an already Closed channel', async () => {
    const { service, lucidService, channelDatum, operator } = createService('Ordered', 'Close');
    const timeoutOnCloseOperator: TimeoutOnClosePacketOperator = { ...operator, proofClose };

    await service.buildUnsignedTimeoutOnClosePacketTx(timeoutOnCloseOperator, 'addr_test1relayer');

    const spendRedeemer = encodedValue(lucidService, 'spendChannelRedeemer');
    expect(spendRedeemer).toEqual({
      TimeoutOnClose: {
        packet: operator.packet,
        proof_unreceived: proofUnreceived,
        proof_close: proofClose,
        proof_height: proofHeight,
        next_sequence_recv: 1n,
      },
    });
    const updatedDatum = encodedValue(lucidService, 'channel');
    expect(updatedDatum.state.channel).toBe(channelDatum.state.channel);
    const proofRedeemer: any = encodeProof.mock.calls[0][0];
    expect(proofRedeemer.BatchVerifyMembership).toHaveLength(1);
    const [nextSequenceMembership, closedChannelMembership] =
      proofRedeemer.BatchVerifyMembership[0];
    expect(nextSequenceMembership).toMatchObject({
      proof: proofUnreceived,
      value: '0000000000000001',
    });
    expect(closedChannelMembership).toMatchObject({
      proof: proofClose,
      path: {
        key_path: [convertString2Hex('ibc'), convertString2Hex('channelEnds/ports/transfer/channels/channel-9')],
      },
    });
    expect(lucidService.createUnsignedTimeoutPacketUnescrowTx.mock.calls[0][0]).toMatchObject({
      timeoutPacketPolicyId: 'timeout-policy',
      encodedVerifyProofRedeemer: 'encoded-verify-proof',
    });
  });

  it('uses closed membership and receipt nonmembership for unordered timeout on close before expiry', async () => {
    const { service, lucidService, operator } = createService('Unordered');
    const timeoutOnCloseOperator: TimeoutOnClosePacketOperator = { ...operator, proofClose };

    await service.buildUnsignedTimeoutOnClosePacketTx(timeoutOnCloseOperator, 'addr_test1relayer');

    const updatedDatum = encodedValue(lucidService, 'channel');
    expect(updatedDatum.state.channel.state).toBe('Open');
    const proofRedeemer: any = encodeProof.mock.calls[0][0];
    expect(proofRedeemer.BatchVerifyMembershipAndNonMembership.memberships).toHaveLength(1);
    expect(proofRedeemer.BatchVerifyMembershipAndNonMembership.memberships[0]).toMatchObject({
      proof: proofClose,
    });
    expect(proofRedeemer.BatchVerifyMembershipAndNonMembership.non_memberships).toEqual([
      expect.objectContaining({
        proof: proofUnreceived,
        path: {
          key_path: [
            convertString2Hex('ibc'),
            convertString2Hex('receipts/ports/transfer/channels/channel-9/sequences/2'),
          ],
        },
      }),
    ]);
  });
});
