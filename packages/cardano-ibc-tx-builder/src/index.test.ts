import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { blake2b } from '@noble/hashes/blake2b';
import {
  buildUnsignedSendPacketTx,
  type LoadedSendPacketContext,
  type SendPacketBuildDependencies,
  type SendPacketOperator,
  type UnsignedSendPacketBurnTxInput,
  type UnsignedSendPacketEscrowTxInput,
} from './index';

function voucherTokenName(fullDenom: string): string {
  const denomHash = Buffer.from(
    blake2b(Buffer.from(fullDenom, 'utf8'), { dkLen: 28 }),
  ).toString('hex');
  return `0014df10${denomHash}`;
}

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
      state: {
        next_sequence_send: 4n,
        packet_commitment: new Map([[1n, 'previous']]),
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
        encodedDatum: 'transfer-escrow-datum',
        shardTokenUnit: `${'55'.repeat(28)}${channelId.slice(0, 8)}`,
      };
    },
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
      requiredAmount: undefined,
    });

    const spendRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'spendChannelRedeemer',
    )?.value as { SendPacket: { packet: { data: string } } };
    const packetData = JSON.parse(
      Buffer.from(spendRedeemer.SendPacket.packet.data, 'hex').toString('utf8'),
    );
    assert.equal(packetData.denom, Buffer.from('lovelace').toString('hex'));
    assert.equal(packetData.amount, '123');
  });

  it('reverse-resolves ibc hashes to voucher burns and deduplicates wallet UTxOs', async () => {
    const fullDenom = 'transfer/channel-7/uatom';
    const voucherUnit = `${'44'.repeat(28)}${voucherTokenName(fullDenom)}`;
    let requestedUnit = '';
    const voucherUtxo = utxo('wallet', 0, {
      [voucherUnit]: 456n,
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
    assert.equal(captured.voucherPolicyId, '44'.repeat(28));
    assert.match(
      captured.voucherTokenUnit,
      new RegExp(`^${'44'.repeat(28)}0014df10[0-9a-f]{56}$`),
    );
    const burnRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'mintVoucherRedeemer',
    )?.value as { BurnVoucher: { data: { denom: string; memo: string } } };
    assert.equal(
      Buffer.from(burnRedeemer.BurnVoucher.data.denom, 'hex').toString('utf8'),
      fullDenom,
    );
    assert.equal(
      Buffer.from(burnRedeemer.BurnVoucher.data.memo, 'hex').toString('utf8'),
      `cardano-ibc:voucher-policy:${'44'.repeat(28)}`,
    );
  });

  it('burns legacy-policy vouchers when the sender holds the legacy asset', async () => {
    const fullDenom = 'transfer/channel-7/uatom';
    const legacyPolicy = '66'.repeat(28);
    const legacyVoucherUnit = `${legacyPolicy}${voucherTokenName(fullDenom)}`;
    const voucherUtxo = utxo('legacy-voucher', 0, {
      [legacyVoucherUnit]: 456n,
    });
    let requestedUnit = '';
    const harness = createDeps({
      loadContext: async () => ({
        ...baseContext(),
        deployment: {
          ...baseContext().deployment,
          voucherPolicyRegistry: {
            active: '44'.repeat(28),
            legacy: [legacyPolicy],
          },
        },
      }),
      resolveIbcDenomHash: async () => ({
        path: 'transfer/channel-7',
        baseDenom: 'uatom',
      }),
      findUtxoAtWithUnit: async (_address, unit) => {
        requestedUnit = unit;
        return voucherUtxo;
      },
      tryFindUtxosAt: async () => [voucherUtxo],
    });

    await buildUnsignedSendPacketTx(
      baseOperator({
        token: {
          denom: `ibc/${'a'.repeat(64)}`,
          amount: 456n,
        },
      }),
      harness.deps,
    );

    const captured = harness.getCapturedBurn();
    assert.ok(captured);
    assert.equal(requestedUnit, legacyVoucherUnit);
    assert.equal(captured.voucherTokenUnit, legacyVoucherUnit);
    assert.equal(captured.voucherPolicyId, legacyPolicy);
    const burnRedeemer = harness.encodedValues.find(
      (entry) => entry.kind === 'mintVoucherRedeemer',
    )?.value as { BurnVoucher: { data: { memo: string } } };
    assert.equal(
      Buffer.from(burnRedeemer.BurnVoucher.data.memo, 'hex').toString('utf8'),
      `cardano-ibc:voucher-policy:${legacyPolicy}`,
    );
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
});
