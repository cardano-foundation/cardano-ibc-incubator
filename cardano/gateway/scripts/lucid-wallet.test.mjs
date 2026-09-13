import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as lucidModule from '@lucid-evolution/lucid';

const require = createRequire(import.meta.url);
const { TxOperationRunnerService } = require('../dist/tx/tx-operation-runner.service.js');
const { LucidService } = require('../dist/shared/modules/lucid/lucid.service.js');
const { CML, Lucid, Emulator, generateEmulatorAccount, Data, mintingPolicyToId } = lucidModule;

function runner(lucid) {
  // Exercise the real wallet-selection guards without unrelated deployment configuration.
  const service = Object.assign(Object.create(LucidService.prototype), {
    lucid, LucidImporter: lucidModule, walletSelectionScopeCounter: 0,
    activeWalletSelectionScopeId: null, explicitWalletSelectionForScopeId: null,
    explicitWalletSelectionAddress: null,
  });
  return new TxOperationRunnerService(service, {
    selectWalletFromAddressWithRetry: async (address) =>
      service.selectWalletFromAddress(address, await lucid.utxosAt(address)),
  }, {}, {});
}

function plan(unsignedTx, address) {
  return {
    operationName: 'wallet-regression', unsignedTx,
    validity: { apply: (tx) => tx },
    wallet: { mode: 'refresh_from_address', address, context: 'wallet-regression' },
    completeOptions: { localUPLCEval: true },
  };
}

function references(inputs) {
  return Array.from({ length: inputs.len() }, (_, index) => {
    const input = inputs.get(index);
    return `${input.transaction_id().to_hex()}#${input.index()}`;
  });
}

test('completion replaces spent inputs captured by an earlier wallet snapshot', async () => {
  const account = generateEmulatorAccount({ lovelace: 750_000_000n });
  const recipient = generateEmulatorAccount({ lovelace: 0n });
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, 'Custom');
  const oldUtxos = await lucid.utxosAt(account.address);
  lucid.selectWallet.fromAddress(account.address, oldUtxos);
  const tx = lucid.newTx().pay.ToAddress(recipient.address, { lovelace: 2_000_000n });

  const spender = await Lucid(emulator, 'Custom');
  spender.selectWallet.fromSeed(account.seedPhrase);
  const payment = await spender.newTx().pay.ToAddress(recipient.address, { lovelace: 2_000_000n }).complete();
  const signed = await payment.sign.withWallet().complete();
  await signed.submit();
  emulator.awaitBlock();
  const freshUtxos = await lucid.utxosAt(account.address);
  assert.ok(freshUtxos.every((utxo) => utxo.txHash !== oldUtxos[0].txHash));

  const result = await runner(lucid).run(plan(tx, account.address));
  const body = CML.Transaction.from_cbor_hex(result.unsignedTxCbor).body();
  const allowed = new Set(freshUtxos.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`));
  assert.ok(references(body.inputs()).every((input) => allowed.has(input)), 'CBOR contains a spent wallet input');
});

test('completion binds refreshed funding, collateral, change and wallet identity', async () => {
  const old = generateEmulatorAccount({ lovelace: 750_000_000n });
  const fresh = generateEmulatorAccount({ lovelace: 750_000_000n });
  const recipient = generateEmulatorAccount({ lovelace: 0n });
  const emulator = new Emulator([old, old, old, fresh, fresh, fresh]);
  const lucid = await Lucid(emulator, 'Custom');
  lucid.selectWallet.fromAddress(old.address, await lucid.utxosAt(old.address));
  const policy = { type: 'PlutusV2', script: '49480100002221200101' };
  const unit = mintingPolicyToId(policy) + '01';
  const tx = lucid.newTx().mintAssets({ [unit]: 1n }, Data.void()).attach.MintingPolicy(policy)
    .pay.ToAddress(recipient.address, { lovelace: 2_000_000n, [unit]: 1n });

  const result = await runner(lucid).run(plan(tx, fresh.address));
  const body = CML.Transaction.from_cbor_hex(result.unsignedTxCbor).body();
  const allowed = new Set((await lucid.utxosAt(fresh.address)).map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`));
  assert.ok([...references(body.inputs()), ...references(body.collateral_inputs())]
    .every((input) => allowed.has(input)), 'CBOR uses the previously selected wallet');
  const addresses = Array.from({ length: body.outputs().len() }, (_, index) => body.outputs().get(index).address().to_bech32());
  assert.ok(addresses.includes(fresh.address), 'Change does not go to the selected wallet');
  assert.ok(!addresses.includes(old.address));
  assert.equal(body.collateral_return().address().to_bech32(), fresh.address);
  assert.equal(await tx.lucidConfig().wallet.address(), fresh.address);
});
