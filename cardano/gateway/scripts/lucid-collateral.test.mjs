import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as esm from '@lucid-evolution/lucid';

const require = createRequire(import.meta.url);
const constant = readFileSync(new URL('../src/config/constant.config.ts', import.meta.url), 'utf8');
const collateralTarget = BigInt(constant.match(/TRANSACTION_SET_COLLATERAL = ([\d_]+)n/)[1].replaceAll('_', ''));
const policy = { type: 'PlutusV2', script: '49480100002221200101' };

function references(inputs) {
  return Array.from({ length: inputs.len() }, (_, index) => inputs.get(index).to_cbor_hex());
}

for (const [format, lucidModule] of [['ESM', esm], ['CommonJS', require('@lucid-evolution/lucid')]]) {
  const { Lucid, Emulator, generateEmulatorAccount, Data, mintingPolicyToId } = lucidModule;
  async function setup(count, expensive = false, highFee = false) {
    const account = generateEmulatorAccount({ lovelace: 750_000_000n });
    const emulator = new Emulator(Array.from({ length: count }, () => account));
    if (highFee) {
      // Model the >3.4 ADA fee of live staged finalization without publishing
      // its large reference scripts. This requires more than 5 ADA collateral.
      emulator.protocolParameters = { ...emulator.protocolParameters, minFeeB: 3_400_000 };
    }
    if (expensive) {
      // A provider evaluation can raise fees enough to require a second input.
      emulator.evaluateTx = async () => [{
        redeemer_tag: 'mint', redeemer_index: 0,
        ex_units: { mem: 10_000_000, steps: 5_000_000_000 },
      }];
    }
    const lucid = await Lucid(emulator, 'Custom');
    lucid.selectWallet.fromSeed(account.seedPhrase);
    const unit = mintingPolicyToId(policy) + '01';
    const tx = lucid.newTx().mintAssets({ [unit]: 1n }, Data.void())
      .attach.MintingPolicy(policy).pay.ToAddress(account.address, {
        lovelace: expensive ? 749_700_000n : 2_000_000n, [unit]: 1n,
      });
    return { tx, lucid, options: { setCollateral: collateralTarget, localUPLCEval: !expensive } };
  }

  function check(tx, inputCount) {
    const body = tx.toTransaction().body();
    const regular = references(body.inputs());
    const collateral = references(body.collateral_inputs());
    assert.equal(regular.length, inputCount);
    assert.equal(collateral.length, 1);
    assert.deepEqual(collateral.filter((input) => regular.includes(input)), []);
    assert.equal(body.total_collateral(), collateralTarget);
    assert.ok(body.total_collateral() <= 10_000_000n);
    assert.ok(body.total_collateral() * 100n >= body.fee() * 150n);
    assert.equal(body.collateral_return().amount().coin() + body.total_collateral(), 750_000_000n);
  }

  test(`${format}: collateral excludes the ordinary funding input`, async () => {
    const { tx, options } = await setup(4);
    check(await tx.complete(options), 1);
  });

  test(`${format}: collateral covers a finalization fee above the old 5 ADA floor`, async () => {
    const { tx, options } = await setup(4, false, true);
    const completed = await tx.complete(options);
    assert.ok(completed.toTransaction().body().fee() * 150n > 5_000_000n * 100n);
    check(completed, 1);
  });

  test(`${format}: additional fee funding leaves selected collateral reserved`, async () => {
    const { tx, options } = await setup(3, true);
    check(await tx.complete(options), 2);
  });

  test(`${format}: fee funding cannot reuse the only remaining collateral`, async () => {
    const { tx, options } = await setup(2, true);
    await assert.rejects(tx.complete(options), /funds|UTxO|selection/i);
  });

  test(`${format}: explicitly collected funds cannot also provide collateral`, async () => {
    const { tx, lucid, options } = await setup(1);
    tx.collectFrom(await lucid.wallet().getUtxos());
    await assert.rejects(tx.complete(options), /collateral/i);
  });
}
