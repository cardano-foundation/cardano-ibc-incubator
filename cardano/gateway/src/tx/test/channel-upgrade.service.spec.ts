import { join, resolve } from 'node:path';
import { loadSync, ServiceDefinition } from '@grpc/proto-loader';
import { MsgChannelUpgradeInit, MsgChannelUpgradeCancel } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import * as Lucid from '@lucid-evolution/lucid';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { packetLaneTokenName, sendSequencerTokenName } from '@cardano-ibc/tx-builder/dist/packet-lanes';
import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { Order as ProtoOrder, State as ProtoState } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import { convertString2Hex } from '@shared/helpers/hex';
import { ICS23MerkleTree } from '@shared/helpers/ics23-merkle-tree';
import { createTestTreeContext } from '@shared/testing/ibc-tree-test-store';
import {
  ChannelDatum,
  encodeChannelEndValue,
  encodeChannelUpgradeRecords,
  initialChannelUpgradeState,
} from '@shared/types/channel/channel-datum';
import { Order } from '@shared/types/channel/order';
import { ChannelState } from '@shared/types/channel/state';
import { State as ConnectionState } from '@shared/types/connection/state';
import { ChannelUpgradeService } from '../channel-upgrade.service';
import { encodeChannelProto, encodeUpgradeProto } from '../../shared/helpers/channel-upgrade-proto';
import { initUpgrade } from '../helper/channel-upgrade';

// The proof contents are checked through the redeemer the service builds.
jest.mock('../../shared/types/connection/verify-proof-redeemer', () => ({
  ...jest.requireActual('../../shared/types/connection/verify-proof-redeemer'),
  encodeVerifyProofRedeemer: jest.fn(() => 'encoded-verify-proof'),
}));

jest.mock('../../shared/helpers/time', () => ({
  ...jest.requireActual('../../shared/helpers/time'),
  computeLedgerAnchoredValidityWindow: jest.fn(async () => ({
    currentSlot: 1,
    currentLedgerTime: 1_699_999_000_000,
    validFromTime: 1_699_999_000_000,
    validToSlot: 2,
    validToTime: 1_700_000_000_000,
  })),
}));

const hex = convertString2Hex;
const VALID_TO = 1_700_000_000_000n;
const STATE_POLICY = '44'.repeat(28);
const CONFIG_UNIT = '55'.repeat(28) + hex('ibc_packet_config');
const DEPLOYER = 'dd'.repeat(28);
const proofHeight = { revisionNumber: 1n, revisionHeight: 40n };
const proofBytes = MerkleProof.encode(
  MerkleProof.fromPartial({
    proofs: [{ exist: { key: new Uint8Array([1]), value: new Uint8Array([2]), leaf: {}, path: [] } }],
  }),
).finish();

function connectionDatum(counterpartyConnection: string) {
  return {
    state: {
      client_id: hex('07-tendermint-0'),
      versions: [{ identifier: hex('1'), features: [hex('ORDER_ORDERED'), hex('ORDER_UNORDERED')] }],
      state: ConnectionState.Open,
      counterparty: {
        client_id: hex('08-cardano-0'),
        connection_id: hex(counterpartyConnection),
        prefix: { key_prefix: hex('ibc') },
      },
      delay_period: 0n,
    },
    token: { policyId: 'cc'.repeat(28), name: '01' },
  };
}

function baseChannel(): ChannelDatum {
  return {
    state: {
      channel: {
        state: ChannelState.Open,
        ordering: Order.Unordered,
        counterparty: { port_id: hex('transfer'), channel_id: hex('channel-7') },
        connection_hops: [hex('connection-0')],
        version: hex('ics20-1'),
        upgrade_sequence: 0n,
      },
      next_sequence_send: 1n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
      packet_commitment: new Map(),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      upgrade: initialChannelUpgradeState(),
    },
    port: hex('transfer'),
    token: { policyId: 'aa'.repeat(28), name: 'bb' },
  };
}

const UPGRADE_FIELDS = { ordering: Order.Unordered, connection_hops: [hex('connection-1')], version: hex('ics20-1') };

async function channelTree(datum: ChannelDatum) {
  const tree = new ICS23MerkleTree();
  tree.set('channelEnds/ports/transfer/channels/channel-0', await encodeChannelEndValue(datum.state.channel, Lucid));
  const records = await encodeChannelUpgradeRecords(datum.state.upgrade, Lucid);
  tree.set('channelUpgrades/upgrades/ports/transfer/channels/channel-0', records.upgrade);
  tree.set('channelUpgrades/upgradeError/ports/transfer/channels/channel-0', records.errorReceipt);
  return tree;
}

async function setup(datum: ChannelDatum, laneCommitments: number[] = []) {
  const tree = await channelTree(datum);
  const context = createTestTreeContext();
  const hostRef = { txHash: '99'.repeat(32), outputIndex: 0 };
  await context.restore(tree, hostRef);
  const utxo = (name: string, datumValue?: string) => ({
    txHash: name,
    outputIndex: 0,
    datum: datumValue ?? name,
    assets: {},
  });
  const lanes = Array.from({ length: 16 }, (_, lane) =>
    utxo(
      `lane-${lane}`,
      Lucid.Data.to(
        new Lucid.Constr(0, [
          hex('transfer'),
          hex('channel-0'),
          BigInt(lane),
          16n,
          0n,
          '',
          new Map(laneCommitments.includes(lane) ? [[1n, 'aa']] : []),
        ]) as any,
      ),
    ),
  );
  const units: Record<string, any> = {
    ['aa'.repeat(28) + 'bb']: utxo('channel', 'channel-datum'),
    'connection-0': utxo('connection-0'),
    'connection-1': utxo('connection-1'),
    client: utxo('client'),
    [CONFIG_UNIT]: utxo('config'),
    [STATE_POLICY + sendSequencerTokenName('transfer', 'channel-0')]: utxo(
      'sequencer',
      Lucid.Data.to(new Lucid.Constr(0, [hex('transfer'), hex('channel-0'), hex('ics20-1'), 6n]) as any),
    ),
    ...Object.fromEntries(
      lanes.map((lane, index) => [STATE_POLICY + packetLaneTokenName('transfer', 'channel-0', index, 16), lane]),
    ),
  };
  const consensusHeight = { ...proofHeight };
  const clientDatum = {
    state: {
      clientState: { latestHeight: proofHeight, frozenHeight: { revisionNumber: 0n, revisionHeight: 0n }, trustingPeriod: 2_000_000_000_000_000_000n },
      consensusStates: new Map([
        [consensusHeight, { timestamp: 10n, next_validators_hash: 'aa', root: { hash: 'bb' } }],
      ]),
      processedTimes: new Map([[consensusHeight, 11n]]),
      processedHeights: new Map([[consensusHeight, 12n]]),
    },
  };
  const lucidService: any = {
    LucidImporter: Lucid,
    getChannelTokenUnit: jest.fn().mockReturnValue(['aa'.repeat(28), 'bb']),
    getConnectionTokenUnit: jest.fn().mockImplementation((sequence: bigint) => ['connection-', `${sequence}`]),
    getClientTokenUnit: jest.fn().mockReturnValue('client'),
    findUtxoByUnit: jest.fn().mockImplementation(async (unit: string) => {
      if (!units[unit]) throw new Error(`no UTxO for ${unit}`);
      return units[unit];
    }),
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({ ...hostRef, datum: 'host-datum', assets: {} }),
    resolveClientAtHeights: jest.fn().mockImplementation(async (clientUtxo: unknown) => ({
      clientUtxo,
      clientDatum,
      historyWitnesses: [],
    })),
    decodeDatum: jest.fn().mockImplementation(async (value: string, type: string) => {
      if (type === 'channel') return datum;
      if (type === 'host_state') {
        return {
          state: { version: 3n, ibc_state_root: tree.getRoot(), last_update_time: 0n },
          deployer: DEPLOYER,
        };
      }
      if (type === 'connection') return connectionDatum(value === 'connection-0' ? 'connection-7' : 'connection-5');
      throw new Error(`unexpected datum ${type}`);
    }),
    encode: jest.fn().mockImplementation(async (_value: unknown, type: string) => `encoded-${type}`),
    createUnsignedChannelUpgradeTransaction: jest.fn().mockResolvedValue('unsigned-tx'),
  };
  const deployment = {
    validators: {
      verifyProof: { scriptHash: 'verify-policy' },
      spendChannel: {
        refValidator: {
          chan_upgrade: { scriptHash: 'upgrade-policy' },
          chan_upgrade_handshake: { scriptHash: 'handshake-policy' },
          chan_upgrade_finish: { scriptHash: 'finish-policy' },
        },
      },
    },
    packetState: {
      laneCount: 16,
      configToken: { policyId: CONFIG_UNIT.slice(0, 56), name: CONFIG_UNIT.slice(56) },
      state: { scriptHash: STATE_POLICY },
    },
  };
  const runner = { run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2]) }) };
  const service = new ChannelUpgradeService(
    { log: jest.fn(), error: jest.fn() } as unknown as Logger,
    {
      get: jest.fn().mockImplementation((key: string) => (key === 'deployment' ? deployment : 'Custom')),
      getOrThrow: jest.fn().mockReturnValue('http://ogmios'),
    } as unknown as ConfigService,
    lucidService,
    runner as any,
    context.store,
  );
  // The emulator slot configuration is not part of this unit.
  (Lucid as any).SLOT_CONFIG_NETWORK.Custom = { zeroTime: 0, zeroSlot: 0, slotLength: 1000 };
  return { service, lucidService, runner, tree, clientDatum };
}

function encoded(lucidService: any, type: string): any {
  return lucidService.encode.mock.calls.find((call: unknown[]) => call[1] === type)?.[0];
}

async function expectRootWitnesses(
  lucidService: any,
  before: ChannelDatum,
  after: ChannelDatum,
  tree: ICS23MerkleTree,
) {
  const redeemer = encoded(lucidService, 'spendChannelRedeemer').ChanUpgrade;
  const expected = tree.clone();
  const updates: Array<[string, string, string, string[]]> = [];
  const oldRecords = await encodeChannelUpgradeRecords(before.state.upgrade, Lucid);
  const newRecords = await encodeChannelUpgradeRecords(after.state.upgrade, Lucid);
  for (const [key, oldValue, newValue, siblings] of [
    [
      'channelEnds/ports/transfer/channels/channel-0',
      await encodeChannelEndValue(before.state.channel, Lucid),
      await encodeChannelEndValue(after.state.channel, Lucid),
      redeemer.channel_siblings,
    ],
    [
      'channelUpgrades/upgrades/ports/transfer/channels/channel-0',
      oldRecords.upgrade.toString('hex'),
      newRecords.upgrade.toString('hex'),
      redeemer.upgrade_siblings,
    ],
    [
      'channelUpgrades/upgradeError/ports/transfer/channels/channel-0',
      oldRecords.errorReceipt.toString('hex'),
      newRecords.errorReceipt.toString('hex'),
      redeemer.error_receipt_siblings,
    ],
  ] as Array<[string, string, string, string[]]>) {
    updates.push([key, oldValue, newValue, siblings]);
    if (oldValue === newValue) {
      expect(siblings).toEqual([]);
    } else {
      expect(siblings).toEqual(expected.getSiblings(key).map((h) => h.toString('hex')));
      expected.set(key, newValue);
    }
  }
  expect(encoded(lucidService, 'host_state').state.ibc_state_root).toBe(expected.getRoot());
  expect(encoded(lucidService, 'host_state').state.version).toBe(4n);
}

describe('ChannelUpgradeService', () => {
  it('builds an authority-signed INIT with the replacement connection and client', async () => {
    const before = baseChannel();
    const { service, lucidService, tree } = await setup(before);

    const response = await service.channelUpgradeInit({
      port_id: 'transfer',
      channel_id: 'channel-0',
      fields: { ordering: ProtoOrder.ORDER_UNORDERED, connection_hops: ['connection-1'], version: 'ics20-1' },
      signer: 'addr_test1authority',
      timeout_period_ms: 3_600_000n,
      expected_upgrade_sequence: 0n,
    });

    const after = initUpgrade(before, UPGRADE_FIELDS, 3_600_000n);
    expect(encoded(lucidService, 'channel')).toEqual(after);
    expect(encoded(lucidService, 'host_state_redeemer')).toBe('UpgradeChannel');
    expect(lucidService.createUnsignedChannelUpgradeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'channelUpgrade',
        operationPolicyId: 'upgrade-policy',
        referenceInputs: [expect.objectContaining({ txHash: 'connection-1' }), expect.objectContaining({ txHash: 'client' })],
        authorityKeyHash: DEPLOYER,
        proof: undefined,
      }),
    );
    await expectRootWitnesses(lucidService, before, after, tree);
    expect(response.upgrade_sequence).toBe(1n);
    expect(response.upgrade.fields!.connection_hops).toEqual(['connection-1']);
  });

  it('checks INIT sequence presence and gRPC Long values before construction', async () => {
    const root = resolve(__dirname, '../../../../..');
    const protoRoot = join(root, 'proto-types/protos/ibc-go');
    const definitions = loadSync(join(protoRoot, 'ibc/core/channel/v1/tx.proto'), {
      keepCase: true, includeDirs: [protoRoot],
    });
    const wire = (definitions['ibc.core.channel.v1.Msg'] as ServiceDefinition).ChannelUpgradeInit;
    for (const sequence of [undefined, 0n, 1n]) {
      const { service, lucidService } = await setup(baseChannel());
      const message = MsgChannelUpgradeInit.fromPartial({
        port_id: 'transfer', channel_id: 'channel-0', signer: 'addr_test1authority',
        fields: { ordering: ProtoOrder.ORDER_UNORDERED, connection_hops: ['connection-1'], version: 'ics20-1' },
        timeout_period_ms: 3_600_000n, expected_upgrade_sequence: sequence,
      });
      // The gRPC boundary carries Long objects despite the generated TypeScript interface.
      const decoded = wire.requestDeserialize(Buffer.from(MsgChannelUpgradeInit.encode(message).finish())) as MsgChannelUpgradeInit;
      if (sequence === 0n) {
        await expect(service.channelUpgradeInit(decoded)).resolves.toMatchObject({ upgrade_sequence: 1n });
      } else {
        await expect(service.channelUpgradeInit(decoded)).rejects.toThrow(/expected upgrade sequence/);
        expect(lucidService.createUnsignedChannelUpgradeTransaction).not.toHaveBeenCalled();
      }
    }
  });

  it('builds a crossing TRY that proves the open counterparty and its proposal', async () => {
    const before = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const { service, lucidService, runner, tree } = await setup(before);

    await service.channelUpgradeTry({
      port_id: 'transfer',
      channel_id: 'channel-0',
      proposed_upgrade_connection_hops: ['connection-1'],
      counterparty_upgrade_fields: {
        ordering: ProtoOrder.ORDER_UNORDERED,
        connection_hops: ['connection-5'],
        version: 'ics20-1',
      },
      counterparty_upgrade_sequence: 2n,
      proof_channel: proofBytes,
      proof_upgrade: proofBytes,
      proof_height: { revision_number: 1n, revision_height: 40n },
      signer: 'addr_test1relayer',
    });

    const after = encoded(lucidService, 'channel') as ChannelDatum;
    expect(after.state.channel.state).toBe(ChannelState.Flushing);
    expect(after.state.channel.upgrade_sequence).toBe(2n);
    expect(after.state.upgrade.pending!.upgrade.next_sequence_send).toBe(6n);
    expect(after.state.upgrade.pending!.upgrade.timeout.timestamp).toBe((VALID_TO + 3_600_000n) * 1_000_000n);
    const dto = lucidService.createUnsignedChannelUpgradeTransaction.mock.calls[0][0];
    expect(dto.operation).toBe('channelUpgradeHandshake');
    expect(dto.referenceInputs.map((u: any) => u.txHash)).toEqual([
      'connection-0',
      'connection-1',
      'client',
      'config',
      'sequencer',
    ]);
    expect(dto.authorityKeyHash).toBeUndefined();
    expect(dto.proof.policyId).toBe('verify-policy');
    await expectRootWitnesses(lucidService, before, after, tree);
    expect(runner.run.mock.calls[0][0].wallet.address).toBe('addr_test1relayer');
  });

  it('proves the counterparty channel and upgrade values the validator expects', async () => {
    const before = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const { service } = await setup(before);
    const build = jest.spyOn(service as any, 'channelAndUpgradeProof');

    await service.channelUpgradeTry({
      port_id: 'transfer',
      channel_id: 'channel-0',
      proposed_upgrade_connection_hops: [],
      counterparty_upgrade_fields: {
        ordering: ProtoOrder.ORDER_UNORDERED,
        connection_hops: ['connection-5'],
        version: 'ics20-1',
      },
      counterparty_upgrade_sequence: 1n,
      proof_channel: proofBytes,
      proof_upgrade: proofBytes,
      proof_height: { revision_number: 1n, revision_height: 40n },
      signer: 'addr_test1relayer',
    });

    const proof = build.mock.results[0].value as any;
    const [channelMembership, upgradeMembership] = proof.redeemer.BatchVerifyMembership[0];
    expect(channelMembership.path.key_path).toEqual([hex('ibc'), hex('channelEnds/ports/transfer/channels/channel-7')]);
    expect(channelMembership.value).toBe(
      Buffer.from(
        encodeChannelProto({
          state: ChannelState.Open,
          ordering: Order.Unordered,
          counterparty: { port_id: hex('transfer'), channel_id: hex('channel-0') },
          connection_hops: [hex('connection-7')],
          version: hex('ics20-1'),
          upgrade_sequence: 1n,
        }),
      ).toString('hex'),
    );
    expect(upgradeMembership.path.key_path).toEqual([
      hex('ibc'),
      hex('channelUpgrades/upgrades/ports/transfer/channels/channel-7'),
    ]);
    // ibc-go writes the empty timeout height of a proposal.
    expect(upgradeMembership.value).toBe('0a190801120c636f6e6e656374696f6e2d351a0769637332302d3112020a00');
    expect(upgradeMembership.value).toBe(
      Buffer.from(
        encodeUpgradeProto({
          fields: { ...UPGRADE_FIELDS, connection_hops: [hex('connection-5')] },
          timeout: { height: { revisionNumber: 0n, revisionHeight: 0n }, timestamp: 0n },
          next_sequence_send: 0n,
        }),
      ).toString('hex'),
    );
  });

  it('flushes the drained lanes before the first lane with commitments', async () => {
    const init = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const before: ChannelDatum = {
      ...init,
      state: {
        ...init.state,
        channel: { ...init.state.channel, state: ChannelState.Flushing },
        upgrade: {
          ...init.state.upgrade,
          pending: { ...init.state.upgrade.pending!, flushed_lanes: 2n },
        },
      },
    };
    const { service, lucidService, tree } = await setup(before, [5]);

    const response = await service.channelUpgradeFlush({
      port_id: 'transfer',
      channel_id: 'channel-0',
      signer: 'addr',
    });

    const dto = lucidService.createUnsignedChannelUpgradeTransaction.mock.calls[0][0];
    expect(dto.referenceInputs.map((u: any) => u.txHash)).toEqual(['config', 'lane-2', 'lane-3', 'lane-4']);
    expect(encoded(lucidService, 'spendChannelRedeemer').ChanUpgrade.step).toEqual({ FlushUpgrade: { lanes: 3n } });
    expect(response.flushed_lanes).toBe(5n);
    expect(response.lane_count).toBe(16n);
    await expectRootWitnesses(lucidService, before, encoded(lucidService, 'channel'), tree);
  });

  it.each(['frozen', 'expired'])('rejects a replacement that becomes %s before the final FLUSH', async (health) => {
    const init = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const before: ChannelDatum = {
      ...init, state: { ...init.state, channel: { ...init.state.channel, state: ChannelState.Flushing },
        upgrade: { ...init.state.upgrade, pending: { ...init.state.upgrade.pending!, flushed_lanes: 8n,
          counterparty_upgrade: { ...init.state.upgrade.pending!.upgrade,
            timeout: { height: { revisionNumber: 0n, revisionHeight: 0n }, timestamp: (VALID_TO + 3_600_000n) * 1_000_000n },
            next_sequence_send: 9n,
          },
        } },
      },
    };
    const { service, clientDatum, lucidService } = await setup(before);
    if (health === 'frozen') clientDatum.state.clientState.frozenHeight.revisionHeight = 1n;
    else clientDatum.state.clientState.trustingPeriod = 1n;
    await expect(service.channelUpgradeFlush({ port_id: 'transfer', channel_id: 'channel-0', signer: 'addr' })).rejects.toThrow(/replacement client is frozen or expired/);
    expect(lucidService.createUnsignedChannelUpgradeTransaction).not.toHaveBeenCalled();
  });

  it('reports a flush with every lane certified', async () => {
    const init = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const before: ChannelDatum = {
      ...init,
      state: {
        ...init.state,
        channel: { ...init.state.channel, state: ChannelState.Flushing },
        upgrade: { ...init.state.upgrade, pending: { ...init.state.upgrade.pending!, flushed_lanes: 16n } },
      },
    };
    const { service } = await setup(before);

    await expect(
      service.channelUpgradeFlush({ port_id: 'transfer', channel_id: 'channel-0', signer: 'addr' }),
    ).rejects.toThrow(/already certified/);
  });

  it('opens only after the counterparty opened', async () => {
    const { service } = await setup(baseChannel());

    await expect(
      service.channelUpgradeOpen({
        port_id: 'transfer',
        channel_id: 'channel-0',
        counterparty_channel_state: ProtoState.STATE_FLUSHCOMPLETE,
        counterparty_upgrade_sequence: 1n,
        proof_channel: proofBytes,
        proof_height: { revision_number: 1n, revision_height: 40n },
        signer: 'addr',
      }),
    ).rejects.toThrow(/only after the counterparty is Open/);
  });

  it('binds authority CANCEL to the observed proposal across the gRPC boundary', async () => {
    const root = resolve(__dirname, '../../../../..');
    const protoRoot = join(root, 'proto-types/protos/ibc-go');
    const definitions = loadSync(join(protoRoot, 'ibc/core/channel/v1/tx.proto'), {
      keepCase: true, includeDirs: [protoRoot],
    });
    const wire = (definitions['ibc.core.channel.v1.Msg'] as ServiceDefinition).ChannelUpgradeCancel;
    const pending = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    for (const sequence of [undefined, 0n, 1n, 2n]) {
      const { service, lucidService } = await setup(pending);
      const message = MsgChannelUpgradeCancel.fromPartial({
        port_id: 'transfer', channel_id: 'channel-0', signer: 'addr_test1authority',
        expected_upgrade_sequence: sequence,
      });
      const decoded = wire.requestDeserialize(Buffer.from(MsgChannelUpgradeCancel.encode(message).finish())) as MsgChannelUpgradeCancel;
      if (sequence === 1n) {
        await expect(service.channelUpgradeCancel(decoded)).resolves.toHaveProperty('unsigned_tx');
      } else {
        await expect(service.channelUpgradeCancel(decoded)).rejects.toThrow(/expected upgrade sequence/);
        expect(lucidService.createUnsignedChannelUpgradeTransaction).not.toHaveBeenCalled();
      }
    }
  });

  it('keeps receipt-backed CANCEL governed by the proven receipt sequence', async () => {
    const before = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const { service, lucidService, tree } = await setup(before);
    await expect(service.channelUpgradeCancel(MsgChannelUpgradeCancel.fromPartial({
      port_id: 'transfer', channel_id: 'channel-0', signer: 'addr_test1relayer',
      error_receipt: { sequence: 3n, message: 'counterparty cancelled' },
      proof_error_receipt: proofBytes,
      proof_height: { revision_number: 1n, revision_height: 40n },
    }))).resolves.toHaveProperty('unsigned_tx');
    const after = {
      ...before,
      state: {
        ...before.state,
        channel: { ...before.state.channel, upgrade_sequence: 3n },
        upgrade: {
          ...before.state.upgrade, pending: null,
          error_receipt: { sequence: 3n, message: hex('ABCI code: 28: restored channel to pre-upgrade state') },
        },
      },
    };
    await expectRootWitnesses(lucidService, before, after, tree);
  });

  it.each([false, true])('rejects CANCEL construction after close-confirm, receipt-backed=%s', async (proven) => {
    const pending = initUpgrade(baseChannel(), UPGRADE_FIELDS, 3_600_000n);
    const closed = {
      ...pending, state: { ...pending.state, channel: { ...pending.state.channel, state: ChannelState.Close } },
    };
    const { service, lucidService } = await setup(closed);
    await expect(service.channelUpgradeCancel(MsgChannelUpgradeCancel.fromPartial({
      port_id: 'transfer', channel_id: 'channel-0', signer: 'addr_test1authority',
      expected_upgrade_sequence: 1n,
      error_receipt: proven ? { sequence: 1n, message: 'counterparty cancelled' } : undefined,
      proof_error_receipt: proven ? proofBytes : new Uint8Array(),
      proof_height: { revision_number: 1n, revision_height: 40n },
    }))).rejects.toThrow(/only an open or flushing channel/);
    expect(lucidService.createUnsignedChannelUpgradeTransaction).not.toHaveBeenCalled();
  });

  it('rejects a TRY that this end did not initialize', async () => {
    const { service } = await setup(baseChannel());

    await expect(
      service.channelUpgradeTry({
        port_id: 'transfer',
        channel_id: 'channel-0',
        proposed_upgrade_connection_hops: ['connection-1'],
        counterparty_upgrade_fields: {
          ordering: ProtoOrder.ORDER_UNORDERED,
          connection_hops: ['connection-5'],
          version: 'ics20-1',
        },
        counterparty_upgrade_sequence: 1n,
        proof_channel: proofBytes,
        proof_upgrade: proofBytes,
        proof_height: { revision_number: 1n, revision_height: 40n },
        signer: 'addr',
      }),
    ).rejects.toThrow(/authority must INIT first/);
  });
});
