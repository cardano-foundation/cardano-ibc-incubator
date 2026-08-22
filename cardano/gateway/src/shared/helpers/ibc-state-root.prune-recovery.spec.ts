import * as Lucid from '@lucid-evolution/lucid';

import { ChannelDatum, encodeChannelEndValue } from '../types/channel/channel-datum';
import { Order } from '../types/channel/order';
import { ChannelState } from '../types/channel/state';
import { ClientDatum, encodeClientStateValue, encodeConsensusStateValue } from '../types/client-datum';
import { ConnectionDatum, encodeConnectionEndValue } from '../types/connection/connection-datum';
import { State as ConnectionState } from '../types/connection/state';
import { ICS23MerkleTree } from './ics23-merkle-tree';
import {
  computeRootWithHandlePacketUpdate,
  clientConnectionCountPath,
  encodeDependencyCount,
  getCurrentTree,
  rebuildTreeFromChain,
  setCurrentTree,
} from './ibc-state-root';

const toHex = (value: string): string => Buffer.from(value, 'utf8').toString('hex');
const authAssetUnit = (policyByte: string, prefixByte: string, sequence: number): string =>
  policyByte.repeat(28) + prefixByte.repeat(24) + toHex(sequence.toString());

describe('IBC state root recovery after packet-history pruning', () => {
  it('rebuilds from live datums alone and can receive another packet', async () => {
    const consensusHeight = { revisionNumber: 0n, revisionHeight: 81n };
    const clientDatum: ClientDatum = {
      state: {
        clientState: {
          chainId: toHex('counterparty-0'),
          trustLevel: { numerator: 1n, denominator: 3n },
          trustingPeriod: 100n,
          unbondingPeriod: 200n,
          maxClockDrift: 5n,
          frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
          latestHeight: consensusHeight,
          proofSpecs: [],
        },
        consensusStates: new Map([
          [
            consensusHeight,
            {
              timestamp: 123n,
              next_validators_hash: '11'.repeat(32),
              root: { hash: '22'.repeat(32) },
            },
          ],
        ]),
        processedTimes: new Map([[consensusHeight, 120n]]),
        processedHeights: new Map([[consensusHeight, 80n]]),
      },
      token: { policyId: '31'.repeat(28), name: '32' },
    };
    const connectionDatum: ConnectionDatum = {
      state: {
        client_id: toHex('07-tendermint-0'),
        versions: [{ identifier: toHex('1'), features: [toHex('ORDER_UNORDERED')] }],
        state: ConnectionState.Open,
        counterparty: {
          client_id: toHex('07-tendermint-9'),
          connection_id: toHex('connection-4'),
          prefix: { key_prefix: toHex('ibc') },
        },
        delay_period: 0n,
      },
      token: { policyId: '41'.repeat(28), name: '42' },
      live_channel_count: 1n,
      lifecycle: 'ConnectionActive',
    };
    const channelDatum: ChannelDatum = {
      state: {
        channel: {
          state: ChannelState.Open,
          ordering: Order.Unordered,
          counterparty: {
            port_id: toHex('transfer'),
            channel_id: toHex('channel-4'),
          },
          connection_hops: [toHex('connection-0')],
          version: toHex('ics20-1'),
        },
        next_sequence_send: 3n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map([[2n, 'aabb']]),
        packet_receipt: new Map([[6n, '']]),
        packet_acknowledgement: new Map([[6n, 'ccdd']]),
        minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 42n },
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 40n },
      },
      port: toHex('transfer'),
      token: { policyId: '51'.repeat(28), name: '52' },
      lifecycle: 'ChannelActive',
    };

    const liveTree = new ICS23MerkleTree();
    liveTree.set(
      'clients/07-tendermint-0/clientState',
      Buffer.from(await encodeClientStateValue(clientDatum.state.clientState, Lucid), 'hex'),
    );
    liveTree.set(
      'clients/07-tendermint-0/consensusStates/81',
      Buffer.from(
        await encodeConsensusStateValue(clientDatum.state.consensusStates.get(consensusHeight), Lucid),
        'hex',
      ),
    );
    liveTree.set(
      'connections/connection-0',
      Buffer.from(await encodeConnectionEndValue(connectionDatum.state, Lucid), 'hex'),
    );
    liveTree.set(clientConnectionCountPath('07-tendermint-0'), encodeDependencyCount(1n));
    liveTree.set(
      'channelEnds/ports/transfer/channels/channel-0',
      Buffer.from(await encodeChannelEndValue(channelDatum.state.channel, Lucid), 'hex'),
    );

    const { Data } = Lucid;
    const integerValue = (value: bigint): Buffer => Buffer.from(Data.to(value as any, Data.Integer() as any), 'hex');
    const packetValue = (value: string): Buffer => Buffer.from(Data.to(value as any, Data.Bytes() as any), 'hex');
    liveTree.set('nextSequenceSend/ports/transfer/channels/channel-0', integerValue(3n));
    liveTree.set('nextSequenceRecv/ports/transfer/channels/channel-0', integerValue(1n));
    liveTree.set('nextSequenceAck/ports/transfer/channels/channel-0', integerValue(1n));
    liveTree.set('commitments/ports/transfer/channels/channel-0/sequences/2', packetValue('aabb'));
    liveTree.set('receipts/ports/transfer/channels/channel-0/sequences/6', packetValue(''));
    liveTree.set('acks/ports/transfer/channels/channel-0/sequences/6', packetValue('ccdd'));

    const prunedReceiptPath = 'receipts/ports/transfer/channels/channel-0/sequences/7';
    const prunedAcknowledgementPath = 'acks/ports/transfer/channels/channel-0/sequences/7';
    const beforePruneTree = liveTree.clone();
    beforePruneTree.set(prunedReceiptPath, packetValue(''));
    beforePruneTree.set(prunedAcknowledgementPath, packetValue('eeff'));
    expect(beforePruneTree.getRoot()).not.toBe(liveTree.getRoot());

    const hostStateDatum = {
      state: {
        ibc_state_root: liveTree.getRoot(),
        version: 12n,
        bound_port: new Map(),
      },
    };
    const clientUtxo = {
      datum: 'client-datum',
      assets: { [authAssetUnit('61', '62', 0)]: 1n },
    };
    const connectionUtxo = {
      datum: 'connection-datum',
      assets: { [authAssetUnit('71', '72', 0)]: 1n },
    };
    const channelUtxo = {
      datum: 'channel-datum',
      assets: { [authAssetUnit('81', '82', 0)]: 1n },
    };
    const kupoService = {
      queryAllClientUtxos: jest.fn().mockResolvedValue([clientUtxo]),
      queryAllConnectionUtxos: jest.fn().mockResolvedValue([connectionUtxo]),
      queryAllChannelUtxos: jest.fn().mockResolvedValue([channelUtxo]),
      queryLatestChannelUtxosFromHistory: jest.fn().mockResolvedValue([]),
    };
    const lucidService = {
      LucidImporter: Lucid,
      findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({ datum: 'host-state-datum' }),
      decodeDatum: jest.fn().mockImplementation(async (datum: string) => {
        if (datum === 'host-state-datum') return hostStateDatum;
        if (datum === 'client-datum') return clientDatum;
        if (datum === 'connection-datum') return connectionDatum;
        if (datum === 'channel-datum') return channelDatum;
        throw new Error(`Unexpected datum: ${datum}`);
      }),
    };

    // Model complete loss of the Gateway's in-memory/off-chain tree.
    setCurrentTree(new ICS23MerkleTree());
    const rebuilt = await rebuildTreeFromChain(kupoService, lucidService);

    expect(rebuilt.root).toBe(hostStateDatum.state.ibc_state_root);
    expect(rebuilt.tree.get(prunedReceiptPath)).toBeUndefined();
    expect(rebuilt.tree.get(prunedAcknowledgementPath)).toBeUndefined();
    expect(rebuilt.tree.get('receipts/ports/transfer/channels/channel-0/sequences/6')).toEqual(packetValue(''));
    expect(rebuilt.tree.get('acks/ports/transfer/channels/channel-0/sequences/6')).toEqual(packetValue('ccdd'));

    const nextSequence = 8n;
    const nextChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        packet_receipt: new Map([...channelDatum.state.packet_receipt, [nextSequence, '']]),
        packet_acknowledgement: new Map([...channelDatum.state.packet_acknowledgement, [nextSequence, '0102']]),
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 90n },
      },
    };
    const continuation = await computeRootWithHandlePacketUpdate(
      rebuilt.root,
      'transfer',
      'channel-0',
      channelDatum,
      nextChannelDatum,
      Lucid,
    );

    expect(continuation.packetReceiptSiblings).toHaveLength(64);
    expect(continuation.packetAcknowledgementSiblings).toHaveLength(64);
    expect(getCurrentTree().getRoot()).toBe(rebuilt.root);
    continuation.commit();

    const newReceiptPath = `receipts/ports/transfer/channels/channel-0/sequences/${nextSequence}`;
    const newAcknowledgementPath = `acks/ports/transfer/channels/channel-0/sequences/${nextSequence}`;
    expect(getCurrentTree().get(newReceiptPath)).toEqual(packetValue(''));
    expect(getCurrentTree().get(newAcknowledgementPath)).toEqual(packetValue('0102'));
    expect(getCurrentTree().verifyProof(getCurrentTree().generateProof(newAcknowledgementPath))).toBe(true);
  });
});
