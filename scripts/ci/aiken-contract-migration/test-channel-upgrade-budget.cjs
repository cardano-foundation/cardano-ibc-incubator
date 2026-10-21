const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../../../cardano/gateway/package.json'));
const CML = req('@dcspark/cardano-multiplatform-lib-nodejs');
const { signedBudget, assertFits } = require('./measure-channel-upgrade.cjs');

function fixture(signatures = true) {
  const body = CML.TransactionBody.new(CML.TransactionInputList.new(), CML.TransactionOutputList.new(), 100n);
  const witness = CML.TransactionWitnessSet.new();
  const list = CML.LegacyRedeemerList.new();
  // Channel, HostState, operation policy and proof verifier must all count.
  for (const [purpose, index, memory, cpu] of [[0, 0, 100, 1000], [0, 1, 200, 2000], [1, 0, 300, 3000], [1, 1, 400, 4000]]) {
    list.add(CML.LegacyRedeemer.new(purpose, BigInt(index), CML.PlutusData.from_cbor_hex('d87980'), CML.ExUnits.new(BigInt(memory), BigInt(cpu))));
  }
  witness.set_redeemers(CML.Redeemers.new_arr_legacy_redeemer(list));
  if (signatures) {
    const keys = CML.VkeywitnessList.new();
    keys.add(CML.make_vkey_witness(CML.hash_transaction(body), CML.PrivateKey.generate_ed25519()));
    witness.set_vkeywitnesses(keys);
  }
  return CML.Transaction.new(body, witness, true);
}

test('budget measurements include signatures and every script purpose', () => {
  const signed = fixture(), budget = signedBudget(signed);
  assert.equal(budget.canonicalSignedBytes, signed.to_cbor_bytes().length);
  assert.equal(budget.signatures, 1);
  assert.equal(budget.memory, 1000n);
  assert.equal(budget.cpu, 10000n);
  assert.equal(budget.redeemers.length, 4);
  assert.throws(() => signedBudget(fixture(false)), /Signed witnesses/);
  const limits = { maxTxSize: budget.canonicalSignedBytes, memory: 1000, steps: 10000 };
  assertFits(budget, limits);
  for (const changed of [{ ...limits, maxTxSize: limits.maxTxSize - 1 }, { ...limits, memory: 999 }, { ...limits, steps: 9999 }]) {
    assert.throws(() => assertFits(budget, changed));
  }
  // Omitting the proof policy would make this transaction appear to fit.
  assert.ok(100n + 200n + 300n <= 999n);
});
