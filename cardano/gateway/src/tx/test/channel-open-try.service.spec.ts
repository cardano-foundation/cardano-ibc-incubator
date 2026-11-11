import * as Lucid from '@lucid-evolution/lucid';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MsgChannelOpenTry } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { Channel, Order } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { convertString2Hex as hex } from '@shared/helpers/hex';
import { ICS23MerkleTree } from '@shared/helpers/ics23-merkle-tree';
import { createTestTreeContext } from '@shared/testing/ibc-tree-test-store';
import { IbcTreePendingUpdatesService } from '@shared/services/ibc-tree-pending-updates.service';
import { ChannelService } from '../channel.service';
import { TxOperationRunnerService } from '../tx-operation-runner.service';
import { TxEventsService } from '../tx-events.service';

jest.mock('../../shared/types/connection/verify-proof-redeemer', () => ({
  ...jest.requireActual('../../shared/types/connection/verify-proof-redeemer'),
  encodeVerifyProofRedeemer: jest.fn(() => 'encoded-proof'),
}));

jest.mock('../../shared/helpers/time', () => ({
  ...jest.requireActual('../../shared/helpers/time'),
  computeLedgerAnchoredValidityWindow: jest.fn(async () => ({ validFromTime: 1000, validToTime: 2000 })),
}));

const txHash = 'aa'.repeat(32);
const proofHeight = { revisionNumber: 888n, revisionHeight: 100n };

async function setup() {
  const tree = new ICS23MerkleTree();
  const context = createTestTreeContext();
  const hostRef = { txHash: '11'.repeat(32), outputIndex: 0 };
  await context.restore(tree, hostRef);
  const oldRoot = tree.getRoot();
  const host = {
    state: { version: 1n, next_channel_sequence: 0n, ibc_state_root: oldRoot, last_update_time: 0n },
    control: { live_channels: 0n },
  };
  const connection = {
    state: {
      client_id: hex('07-tendermint-0'),
      counterparty: { connection_id: hex('connection-436'), prefix: { key_prefix: hex('ibc') } },
      delay_period: 0n,
    },
  };
  const builder: any = {
    validFrom: jest.fn().mockReturnThis(),
    validTo: jest.fn().mockReturnThis(),
    lucidConfig: () => ({}),
    complete: jest.fn().mockResolvedValue({ toCBOR: () => '84a0', toHash: () => txHash }),
  };
  const lucid: any = {
    LucidImporter: Lucid,
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({ ...hostRef, datum: 'host', assets: {} }),
    findUtxoByUnit: jest.fn().mockResolvedValue({ datum: 'connection', assets: {} }),
    decodeDatum: jest.fn(async (_datum, type) => type === 'host_state' ? host : connection),
    getConnectionTokenUnit: jest.fn(() => ['connection', '']),
    getClientTokenUnit: jest.fn(() => 'client'),
    getChannelTokenUnit: jest.fn(() => ['22'.repeat(28), '01']),
    resolveClientAtHeights: jest.fn(async () => ({
      clientDatum: {
        state: {
          clientState: {},
          consensusStates: new Map([[proofHeight, {}]]),
          processedTimes: new Map([[proofHeight, 1n]]),
          processedHeights: new Map([[proofHeight, 1n]]),
        },
      },
      historyWitnesses: [],
    })),
    encode: jest.fn(async (_datum, type) => `encoded-${type}`),
    createUnsignedChannelOpenTryTransaction: jest.fn(async () => builder),
    tryFindUtxosAt: jest.fn(async () => [{ assets: { lovelace: 100_000_000n } }]),
    selectWalletFromAddress: jest.fn(),
    beginWalletSelectionScope: jest.fn(() => 1),
    assertWalletSelectionScopeSatisfied: jest.fn(),
    endWalletSelectionScope: jest.fn(),
    lucid: { wallet: () => ({}) },
  };
  const pending = new IbcTreePendingUpdatesService();
  const events = new TxEventsService();
  const runner = new TxOperationRunnerService(lucid, {
    selectWalletFromAddressWithRetry: async () => lucid.selectWalletFromAddress(),
  } as any, events, pending);
  const deployment = {
    validators: { verifyProof: { scriptHash: '33'.repeat(28) } },
    modules: { transfer: { identifier: 'transfer-module', address: 'transfer-address' } },
  };
  const service = new ChannelService(
    { log: jest.fn(), error: jest.fn() } as unknown as Logger,
    {
      get: (key: string) => key === 'deployment' ? deployment : 'Preview',
      getOrThrow: () => deployment,
    } as unknown as ConfigService,
    lucid,
    runner,
    context.store,
  );
  const request = MsgChannelOpenTry.fromPartial({
    port_id: 'transfer',
    signer: 'relay-wallet',
    channel: Channel.fromPartial({
      ordering: Order.ORDER_UNORDERED,
      counterparty: { port_id: 'transfer', channel_id: 'channel-77166' },
      connection_hops: ['connection-0'],
      version: 'ics20-1',
    }),
    counterparty_version: 'ics20-1',
    proof_height: { revision_number: 888n, revision_height: 100n },
    proof_init: MerkleProof.encode(MerkleProof.fromPartial({
      proofs: [{ exist: { key: new Uint8Array([1]), value: new Uint8Array([2]), leaf: {}, path: [] } }],
    })).finish(),
  });
  return { service, request, context, oldRoot, pending, events, lucid, builder };
}

it('stages the exact channel tree update and OpenTry event until confirmation', async () => {
  const { service, request, context, oldRoot, pending, events, lucid } = await setup();
  const response = await service.channelOpenTry(request);
  expect(response.version).toBe('ics20-1');
  expect(Buffer.from(response.unsigned_tx!.value).toString()).toBe('84a0');
  const update = pending.peek(txHash)!;
  expect(update).toBeDefined();
  const nextHost = lucid.encode.mock.calls.find(([, type]: unknown[]) => type === 'host_state')[0];
  expect(update.expectedNewRoot).toBe(nextHost.state.ibc_state_root);
  expect(update.expectedNewRoot).not.toBe(oldRoot);
  expect((await context.store.getAlignedSnapshot()).root).toBe(oldRoot);
  expect(events.take(txHash)).toEqual([{
    type: 'channel_open_try',
    attributes: [
      { key: 'port_id', value: 'transfer' },
      { key: 'channel_id', value: 'channel-0' },
      { key: 'connection_id', value: 'connection-0' },
      { key: 'counterparty_port_id', value: 'transfer' },
      { key: 'counterparty_channel_id', value: 'channel-77166' },
    ],
  }]);
  const confirmedRef = context.setLiveRoot(update.expectedNewRoot, { txHash, outputIndex: 0 });
  await pending.commit(txHash, update as any, confirmedRef);
  expect((await context.store.getAlignedSnapshot()).root).toBe(update.expectedNewRoot);
  expect(pending.peek(txHash)).toBeUndefined();
});

it('leaves the tree and tracking caches unchanged when completion fails', async () => {
  const { service, request, context, oldRoot, pending, events, builder } = await setup();
  builder.complete.mockRejectedValueOnce(new Error('completion failed'));
  await expect(service.channelOpenTry(request)).rejects.toThrow('completion failed');
  expect(pending.peek(txHash)).toBeUndefined();
  expect(events.take(txHash)).toBeUndefined();
  expect((await context.store.getAlignedSnapshot()).root).toBe(oldRoot);
});
