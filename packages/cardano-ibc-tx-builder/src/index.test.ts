import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import {
  buildUnsignedSendPacketTx,
  MAX_PACKET_ENTRIES_PER_CHANNEL,
  type LoadedSendPacketContext,
  type SendPacketBuildDependencies,
  type SendPacketOperator,
  type UnsignedSendPacketBurnTxInput,
  type UnsignedSendPacketEscrowTxInput,
} from './index';

function utxo(
  txHash: string,
  outputIndex: number,
  assets: Record<string, bigint> = { lovelace: 5_000_000n },
): UTxO {
  return {
    txHash,
    outputIndex,
    address: `addr_test_${txHash}_${outputIndex}`,
    assets,
  } as unknown as UTxO;
}

function baseOperator(overrides: Partial<SendPacketOperator> = {}): SendPacketOperator {
  return {
    sourcePort: 'transfer',
    sourceChannel: 'channel-7',
    token: {
      denom: 'lovelace',
      amount: 123n,
    },
    sender: 'addr_sender',
    receiver: 'osmo1receiver',
    signer: 'addr_signer',
    timeoutHeight: {
      revisionNumber: 0n,
      revisionHeight: 10n,
    },
    timeoutTimestamp: 99n,
    memo: '',
    ...overrides,
  };
}

function baseContext(): LoadedSendPacketContext {
  return {
    channelUtxo: utxo('channel', 0),
    channelDatum: {
      port: 'transfer',
      lifecycle: 'ChannelActive',
      state: {
        next_sequence_send: 4n,
        packet_commitment: new Map([[1n, 'previous']]),
        packet_receipt: new Map(),
        packet_acknowledgement: new Map(),
        minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        channel: {
          connection_hops: ['connection-0'],
          counterparty: {
            port_id: Buffer.from('transfer').toString('hex'),
            channel_id: Buffer.from('channel-2').toString('hex'),
          },
        },
      },
    },
    connectionUtxo: utxo('connection', 0),
    connectionDatum: {
      state: {
        client_id: '07-tendermint-0',
      },
      live_channel_count: 1n,
      lifecycle: 'ConnectionActive',
    },
    clientUtxo: utxo('client', 0),
    transferModuleReferenceUtxo: utxo('transfer-module-ref', 0),
    channelTokenUnit: `${'11'.repeat(28)}${'22'.repeat(8)}`,
    channelToken: {
      policyId: '11'.repeat(28),
      name: '22'.repeat(8),
    },
    deployment: {
      sendPacketPolicyId: '33'.repeat(28),
      mintVoucherScriptHash: '44'.repeat(28),
      transferEscrowShardPolicyId: '55'.repeat(28),
      spendChannelAddress: 'addr_spend_channel',
      transferModuleAddress: 'addr_transfer_module',
      transferModuleIdentifier: `${'66'.repeat(28)}01`,
    },
  };
}

function createDeps(overrides: Partial<SendPacketBuildDependencies> = {}) {
  const encodedValues: Array<{ value: unknown; kind: string }> = [];
  let capturedEscrow: UnsignedSendPacketEscrowTxInput | undefined;
  let capturedBurn: UnsignedSendPacketBurnTxInput | undefined;
  const findTransferEscrowShardCalls: Array<{
    channelId: string;
    packetDenom: string;
    denomToken: string;
    requiredAmount?: bigint;
  }> = [];
  const deps: SendPacketBuildDependencies = {
    loadContext: async () => baseContext(),
    buildHostStateUpdate: async () => ({
      hostStateUtxo: utxo('host-state', 0),
      encodedHostStateRedeemer: 'host-state-redeemer',
      encodedUpdatedHostStateDatum: 'host-state-datum',
      newRoot: 'new-root',
      commit: () => undefined,
    }),
    resolveIbcDenomHash: async () => null,
    commitPacket: () => 'packet-commitment',
    encode: async (value, kind) => {
      encodedValues.push({ value, kind });
      return `${kind}-${encodedValues.length}`;
    },
    findUtxoAtWithUnit: async () => utxo('voucher', 0, {}),
    tryFindUtxosAt: async () => [utxo('wallet', 0), utxo('wallet', 1)],
    findTransferEscrowShard: async (
      channelId,
      packetDenom,
      denomToken,
      requiredAmount,
    ) => {
      findTransferEscrowShardCalls.push({
        channelId,
        packetDenom,
        denomToken,
        requiredAmount,
      });
      return {
        kind: 'missing',
        transferModuleUtxo: utxo('scanned-transfer-module-root', 0),
        encodedDatum: 'transfer-escrow-datum',
        shardTokenUnit: `${'55'.repeat(28)}${channelId.slice(0, 8)}`,
        registrySiblings: ['00'.repeat(32)],
        oldChannelLiveEscrowShardCount: 0n,
        channelLiveEscrowShardCountSiblings: ['11'.repeat(32)],
        encodedUpdatedTransferModuleDatum: 'updated-transfer-module-datum',
      };
    },
    buildTransferModuleVoucherSupplyUpdate: async () =>
      'updated-transfer-module-supply-datum',
    createUnsignedSendPacketBurnTx: (dto) => {
      capturedBurn = dto;
      return {} as TxBuilder;
    },
    createUnsignedSendPacketEscrowTx: (dto) => {
      capturedEscrow = dto;
      return {} as TxBuilder;
    },
    invalidArgument: (message) => new Error(message),
    internalError: (message) => new Error(message),
    ...overrides,
  };
  return {
    deps,
    encodedValues,
    findTransferEscrowShardCalls,
    getCapturedEscrow: () => capturedEscrow,
    getCapturedBurn: () => capturedBurn,
  };
}

describe('send-packet denom mapping', () => {
  it('maps lovelace to the ICS-20 packet denom while spending the Cardano asset unit', async () => {
    const harness = createDeps();

    const result = await buildUnsignedSendPacketTx(baseOperator(), harness.deps);
    const captured = harness.getCapturedEscrow();

    assert.ok(captured);
    assert.equal(captured.denomToken, 'lovelace');
    assert.equal(captured.transferAmount, 123n);
    assert.equal(result.pendingTreeUpdate.expectedNewRoot, 'new-root');
    assert.equal(harness.findTransferEscrowShardCalls.length, 1);
    assert.deepEqual(harness.findTransferEscrowShardCalls[0], {
      channelId: Buffer.from('channel-7').toString('hex'),
      packetDenom: Buffer.from(
        Buffer.from('lovelace').toString('hex'),
      ).toString('hex'),
      denomToken: 'lovelace',
        requiredAmount: 123n,
    });

    const spendRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'spendChannelRedeemer',
    )?.value as { SendPacket: { packet: { data: string } } };
    const packetData = JSON.parse(
      Buffer.from(spendRedeemer.SendPacket.packet.data, 'hex').toString('utf8'),
    );
    assert.equal(packetData.denom, Buffer.from('lovelace').toString('hex'));
    assert.equal(packetData.amount, '123');
    const moduleRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'transferIBCModuleRedeemer',
    )?.value as {
      Callback: [
        {
          OnSendPacket: {
            channel_id: string;
            packet_data: string;
            packet_commitment: string;
            data: unknown;
          };
        },
      ];
    };
    assert.deepEqual(moduleRedeemer.Callback[0].OnSendPacket, {
      channel_id: Buffer.from('channel-7').toString('hex'),
      packet_data: spendRedeemer.SendPacket.packet.data,
      packet_commitment: 'packet-commitment',
      data: {
        ModuleDataV1: [
          {
            denom: Buffer.from(
              Buffer.from('lovelace').toString('hex'),
            ).toString('hex'),
            amount: Buffer.from('123').toString('hex'),
            sender: Buffer.from('addr_sender').toString('hex'),
            receiver: Buffer.from('osmo1receiver').toString('hex'),
            memo: '',
          },
        ],
      },
    });
    assert.deepEqual(
      captured.transferModuleReferenceUtxo,
      utxo('scanned-transfer-module-root', 0),
    );
    assert.equal(
      captured.encodedUpdatedTransferModuleDatum,
      'updated-transfer-module-datum',
    );
    const shardRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'transferEscrowShardRedeemer',
    )?.value as {
      CreateEscrowShardV2: {
        registry_siblings: string[];
        old_channel_live_escrow_shard_count: bigint;
        channel_live_escrow_shard_count_siblings: string[];
      };
    };
    assert.deepEqual(shardRedeemer.CreateEscrowShardV2.registry_siblings, [
      '00'.repeat(32),
    ]);
    assert.equal(
      shardRedeemer.CreateEscrowShardV2.old_channel_live_escrow_shard_count,
      0n,
    );
    assert.deepEqual(
      shardRedeemer.CreateEscrowShardV2
        .channel_live_escrow_shard_count_siblings,
      ['11'.repeat(32)],
    );
  });

  it('reverse-resolves ibc hashes to voucher burns and deduplicates wallet UTxOs', async () => {
    const fullDenom = 'transfer/channel-7/uatom';
    let requestedUnit = '';
    const voucherUtxo = utxo('wallet', 0, {
      [`${'44'.repeat(28)}voucher`]: 456n,
    });
    const harness = createDeps({
      resolveIbcDenomHash: async () => ({
        path: 'transfer/channel-7',
        baseDenom: 'uatom',
      }),
      findUtxoAtWithUnit: async (_address, unit) => {
        requestedUnit = unit;
        return voucherUtxo;
      },
      tryFindUtxosAt: async () => [voucherUtxo, utxo('wallet', 1)],
    });

    const ibcHash = 'a'.repeat(64);
    await buildUnsignedSendPacketTx(
      baseOperator({
        token: {
          denom: `ibc/${ibcHash}`,
          amount: 456n,
        },
      }),
      harness.deps,
    );
    const captured = harness.getCapturedBurn();

    assert.ok(captured);
    assert.equal(captured.denomToken, `ibc/${ibcHash}`);
    assert.equal(captured.transferAmount, 456n);
    assert.equal(captured.walletUtxos?.length, 2);
    assert.equal(captured.voucherTokenUnit, requestedUnit);
    assert.ok(captured.encodedSpendTransferModuleRedeemer);
    assert.deepEqual(
      captured.transferModuleReferenceUtxo,
      baseContext().transferModuleReferenceUtxo,
    );
    assert.match(
      captured.voucherTokenUnit,
      new RegExp(`^${'44'.repeat(28)}0014df10[0-9a-f]{56}$`),
    );
    const burnRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'mintVoucherRedeemer',
    )?.value as {
      BurnVoucher: {
        data: { denom: string };
        module_token: { policy_id: string; name: string };
      };
    };
    assert.equal(
      Buffer.from(burnRedeemer.BurnVoucher.data.denom, 'hex').toString('utf8'),
      fullDenom,
    );
    assert.deepEqual(burnRedeemer.BurnVoucher.module_token, {
      policy_id: '66'.repeat(28),
      name: '01',
    });
  });

  it('rejects unresolved ibc hash denoms before building a transaction', async () => {
    const harness = createDeps({
      resolveIbcDenomHash: async () => null,
    });

    await assert.rejects(
      () =>
        buildUnsignedSendPacketTx(
          baseOperator({
            token: {
              denom: `ibc/${'b'.repeat(64)}`,
              amount: 1n,
            },
          }),
          harness.deps,
        ),
      /not found in denom traces/,
    );
    assert.equal(harness.getCapturedEscrow(), undefined);
    assert.equal(harness.getCapturedBurn(), undefined);
  });

  it('rejects a malformed transfer module identifier before encoding a voucher burn', async () => {
    const context = baseContext();
    context.deployment.transferModuleIdentifier = 'not-an-asset-unit';
    const harness = createDeps({
      loadContext: async () => context,
      resolveIbcDenomHash: async () => ({ path: 'transfer/channel-7', baseDenom: 'uatom' }),
    });

    await assert.rejects(
      () =>
        buildUnsignedSendPacketTx(
          baseOperator({ token: { denom: `ibc/${'c'.repeat(64)}`, amount: 1n } }),
          harness.deps,
        ),
      /not a canonical Cardano asset unit/,
    );
    assert.equal(harness.getCapturedBurn(), undefined);
  });

  it('rejects sends before full combined packet state reaches the chain', async () => {
    let hostStateBuilds = 0;
    const fullContext = baseContext();
    fullContext.channelDatum.state.packet_commitment = new Map();
    fullContext.channelDatum.state.packet_receipt = new Map<bigint, string>(
      Array.from({ length: MAX_PACKET_ENTRIES_PER_CHANNEL / 2 }, (_, index) => [
        BigInt(index + 1),
        `receipt-${index + 1}`,
      ] as [bigint, string]),
    );
    fullContext.channelDatum.state.packet_acknowledgement = new Map<
      bigint,
      string
    >(
      Array.from({ length: MAX_PACKET_ENTRIES_PER_CHANNEL / 2 }, (_, index) => [
        BigInt(index + 1),
        `acknowledgement-${index + 1}`,
      ] as [bigint, string]),
    );
    const harness = createDeps({
      loadContext: async () => fullContext,
      buildHostStateUpdate: async () => {
        hostStateBuilds += 1;
        throw new Error('must not build HostState after capacity rejection');
      },
    });

    await assert.rejects(
      () => buildUnsignedSendPacketTx(baseOperator(), harness.deps),
      /retained packet state capacity of 64 is exhausted/,
    );
    assert.equal(hostStateBuilds, 0);
    assert.equal(harness.getCapturedEscrow(), undefined);
    assert.equal(harness.getCapturedBurn(), undefined);
  });
});
