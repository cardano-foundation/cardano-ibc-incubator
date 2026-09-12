import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import type { UnsignedSendPacketEscrowTxInput } from '@cardano-ibc/tx-builder';
import { createUnsignedSendPacketEscrowTx, type SendPacketEscrowDependencies } from './sendPacketEscrow';

const ASSET = 'ab'.repeat(28) + '01';
const SHARD = 'cd'.repeat(28) + '02';
const ROOT_ADDRESS = 'module-root-address';
const ESCROW_ADDRESS = 'module-escrow-address';

function utxo(txHash: string, assets: Record<string, bigint> = {}): UTxO {
  return { txHash, outputIndex: 0, address: 'input-address', assets };
}

function fixture(overrides: Partial<UnsignedSendPacketEscrowTxInput> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const tx = {} as TxBuilder;
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return tx;
  };
  Object.assign(tx, {
    readFrom: record('readFrom'),
    collectFrom: record('collectFrom'),
    mintAssets: record('mintAssets'),
    pay: { ToContract: record('ToContract') },
  });
  let newTxCalls = 0;
  const dependencies: SendPacketEscrowDependencies = {
    newTx: () => { newTxCalls += 1; return tx; },
    hostStateAddress: 'host-state-address',
    hostStateTokenUnit: 'host-state-token',
    transferModuleRootAddress: ROOT_ADDRESS,
    referenceScripts: {
      spendChannel: utxo('ref-channel'),
      spendTransferModule: utxo('ref-transfer'),
      mintTransferEscrowShard: utxo('ref-shard'),
      sendPacket: utxo('ref-send'),
      hostStateStt: utxo('ref-host-state'),
    },
    encodeAuthToken: () => 'auth-token-redeemer',
  };
  const dto: UnsignedSendPacketEscrowTxInput = {
    hostStateUtxo: {
      ...utxo('host-state', { lovelace: 8_000_000n, 'host-state-token': 1n, reserve: 7n }),
      datum: 'raw-host-state',
      datumHash: 'cached-datum-hash',
    },
    encodedHostStateRedeemer: 'host-state-redeemer',
    encodedUpdatedHostStateDatum: 'updated-host-state',
    channelUTxO: utxo('channel', { lovelace: 9_000_000n, 'channel-token': 1n }),
    connectionUTxO: utxo('connection'),
    clientUTxO: utxo('client'),
    transferModuleReferenceUtxo: utxo('module-root', { lovelace: 5_000_000n, 'module-id': 1n, 'port-id': 1n }),
    encodedSpendChannelRedeemer: 'channel-redeemer',
    encodedUpdatedChannelDatum: 'updated-channel',
    channelTokenUnit: 'channel-token',
    encodedSpendTransferModuleRedeemer: 'module-redeemer',
    encodedMintTransferEscrowShardRedeemer: 'shard-redeemer',
    encodedUpdatedTransferModuleDatum: 'updated-module-root',
    transferAmount: 12n,
    constructedAddress: 'operator',
    sendPacketPolicyId: 'send-policy',
    channelToken: { policyId: 'channel-policy', name: 'channel-name' },
    senderAddress: 'sender',
    receiverAddress: 'receiver',
    walletUtxos: [utxo('wallet', { [ASSET]: 12n })],
    spendChannelAddress: 'channel-address',
    transferModuleAddress: ESCROW_ADDRESS,
    denomToken: ASSET,
    encodedTransferEscrowDatum: 'escrow-datum',
    transferEscrowShardTokenUnit: SHARD,
    ...overrides,
  };
  return { dependencies, dto, tx, calls, newTxCalls: () => newTxCalls };
}

describe('shared send packet escrow transaction', () => {
  it('creates the first shard while preserving every continuing state balance and the raw HostState datum', () => {
    const f = fixture();
    assert.equal(createUnsignedSendPacketEscrowTx(f.dependencies, f.dto), f.tx);
    assert.deepEqual(f.calls, [
      { method: 'readFrom', args: [Object.values(f.dependencies.referenceScripts)] },
      { method: 'collectFrom', args: [[{ ...f.dto.hostStateUtxo, datumHash: undefined }], 'host-state-redeemer'] },
      { method: 'collectFrom', args: [[f.dto.channelUTxO], 'channel-redeemer'] },
      { method: 'readFrom', args: [[f.dto.connectionUTxO, f.dto.clientUTxO]] },
      { method: 'ToContract', args: ['host-state-address', { kind: 'inline', value: 'updated-host-state' }, f.dto.hostStateUtxo.assets] },
      { method: 'ToContract', args: ['channel-address', { kind: 'inline', value: 'updated-channel' }, f.dto.channelUTxO.assets] },
      { method: 'mintAssets', args: [{ 'send-policy': 1n }, 'auth-token-redeemer'] },
      { method: 'collectFrom', args: [[f.dto.transferModuleReferenceUtxo], 'module-redeemer'] },
      { method: 'mintAssets', args: [{ [SHARD]: 1n }, 'shard-redeemer'] },
      { method: 'ToContract', args: [ROOT_ADDRESS, { kind: 'inline', value: 'updated-module-root' }, f.dto.transferModuleReferenceUtxo.assets] },
      { method: 'ToContract', args: [ESCROW_ADDRESS, { kind: 'inline', value: 'escrow-datum' }, { [ASSET]: 12n, [SHARD]: 1n }] },
    ]);
    assert.equal(f.dto.hostStateUtxo.datumHash, 'cached-datum-hash');
  });

  for (const denomToken of [ASSET, 'lovelace']) {
    it(`updates an existing ${denomToken === ASSET ? 'native-token' : 'lovelace'} shard without spending the root or minting a shard`, () => {
      const assets = { lovelace: 2_000_000n, [denomToken]: 20n, [SHARD]: 1n };
      const existing = utxo('existing-shard', assets);
      const f = fixture({ transferEscrowUtxo: existing, denomToken });
      createUnsignedSendPacketEscrowTx(f.dependencies, f.dto);
      assert.deepEqual(f.calls.slice(7), [
        { method: 'readFrom', args: [[f.dto.transferModuleReferenceUtxo]] },
        { method: 'collectFrom', args: [[existing], 'module-redeemer'] },
        { method: 'ToContract', args: [ESCROW_ADDRESS, { kind: 'inline', value: 'escrow-datum' }, { ...assets, [denomToken]: 32n }] },
      ]);
      assert.equal(existing.assets[denomToken], 20n);
      assert.equal(f.calls.filter((call) => call.method === 'mintAssets').length, 1);
    });
  }

  it('rejects incomplete escrow data before creating a transaction and preserves adapter errors', () => {
    class AdapterError extends Error {}
    const cases: [Partial<UnsignedSendPacketEscrowTxInput>, RegExp][] = [
      [{ walletUtxos: [] }, /Sender wallet UTxOs are required/],
      [{ encodedTransferEscrowDatum: undefined }, /Transfer escrow datum is required/],
      [{ transferEscrowShardTokenUnit: undefined }, /shard token/],
      [{ encodedUpdatedTransferModuleDatum: undefined }, /shard token/],
      [{ encodedMintTransferEscrowShardRedeemer: undefined }, /shard mint redeemer/],
    ];
    for (const [overrides, message] of cases) {
      const f = fixture(overrides);
      f.dependencies.internalError = (text) => new AdapterError(text);
      assert.throws(() => createUnsignedSendPacketEscrowTx(f.dependencies, f.dto), (error) => {
        assert.ok(error instanceof AdapterError);
        assert.match(error.message, message);
        return true;
      });
      assert.equal(f.newTxCalls(), 0);
      assert.deepEqual(f.calls, []);
    }
  });
});
