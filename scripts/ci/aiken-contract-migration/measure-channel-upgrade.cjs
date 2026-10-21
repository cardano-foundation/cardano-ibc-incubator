// Measure every redeemer in a signed, ledger-accepted upgrade transaction.
// Declared execution units are an upper bound enforced by the actual ledger.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { ownedRuntimeProviders } = require('./owned-runtime-providers.cjs');
const { channelUnit } = require('./verify-migration-packet.cjs');
const { authenticateBlock } = require('./authenticate-migration-block.cjs');
const root = path.resolve(__dirname, '../../..');
const req = createRequire(path.join(root, 'cardano/gateway/package.json'));
const CML = req('@dcspark/cardano-multiplatform-lib-nodejs');

function signedBudget(transaction) {
  assert.ok(transaction.is_valid());
  const witnesses = transaction.witness_set();
  assert.ok((witnesses.vkeywitnesses()?.len() ?? 0) > 0, 'Signed witnesses are required');
  const flat = witnesses.redeemers()?.to_flat_format();
  assert.ok(flat && flat.len() > 0, 'Complete script execution inventory is required');
  const redeemers = Array.from({ length: flat.len() }, (_, index) => {
    const item = flat.get(index), units = item.ex_units();
    return { purpose: item.tag(), index: Number(item.index()), memory: units.mem(), cpu: units.steps(),
      dataBytes: item.data().to_cbor_bytes().length, data: item.data().to_cbor_hex() };
  });
  assert.equal(new Set(redeemers.map(item => `${item.purpose}:${item.index}`)).size, redeemers.length);
  return { transaction: CML.hash_transaction(transaction.body()).to_hex(),
    canonicalSignedBytes: transaction.to_cbor_bytes().length,
    signatures: witnesses.vkeywitnesses().len(), inputs: transaction.body().inputs().len(),
    collateralInputs: transaction.body().collateral_inputs()?.len() ?? 0,
    referenceInputs: transaction.body().reference_inputs()?.len() ?? 0,
    memory: redeemers.reduce((sum, item) => sum + item.memory, 0n),
    cpu: redeemers.reduce((sum, item) => sum + item.cpu, 0n), redeemers };
}

function assertFits(budget, limits) {
  assert.ok(budget.canonicalSignedBytes <= Number(limits.maxTxSize), 'Signed transaction exceeds the ledger size limit');
  assert.ok(budget.memory <= BigInt(limits.memory), 'Aggregate memory exceeds the ledger limit');
  assert.ok(budget.cpu <= BigInt(limits.steps), 'Aggregate CPU exceeds the ledger limit');
}

async function main() {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert.match(request.transaction, /^[0-9a-f]{64}$/);
  const runtime = fs.realpathSync(request.runtime);
  const providers = ownedRuntimeProviders(runtime);
  const baseline = JSON.parse(fs.readFileSync(path.join(runtime, 'result.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'hermes-bridge-manifest.json')));
  assert.equal(manifest.schema_version, 6);
  const lucid = await import(pathToFileURL(req.resolve('@lucid-evolution/lucid')).href);
  const { decodeSpendChannelRedeemer } = req('./dist/shared/types/channel/channel-redeemer.js');
  const { MiniProtocalsService } = req('./dist/shared/modules/mini-protocals/mini-protocals.service.js');
  const { Client } = req('pg');
  const db = new Client({ host: '127.0.0.1', port: Number(providers.historyDb.split(':')[1]),
    database: 'yaci_store', user: 'yaci', password: 'devkit' });
  await db.connect();
  try {
    const fetcher = new MiniProtocalsService({}, { get: key => key === 'yaciStoreEndpoint' ? `http://${providers.history}` : undefined },
      { log() {}, warn() {}, error() {}, debug() {} });
    const cache = new Map();
    async function canonical(hash) {
      if (cache.has(hash)) return cache.get(hash);
      const rows = (await db.query('SELECT t.tx_index,t.block,t.block_hash,b.slot FROM transaction t JOIN block b ON b.number=t.block AND b.hash=t.block_hash WHERE t.tx_hash=$1 AND t.invalid=false', [hash])).rows;
      assert.equal(rows.length, 1, 'Unique valid canonical transaction is required');
      const inclusion = rows[0];
      const bytes = await fetcher.fetchBlockCbor({ hash: inclusion.block_hash, slotNo: BigInt(inclusion.slot) });
      const block = authenticateBlock(bytes, inclusion.block_hash), index = Number(inclusion.tx_index);
      assert.ok(!block.invalid_transactions().includes(index));
      const body = block.transaction_bodies().get(index);
      assert.equal(CML.hash_transaction(body).to_hex(), hash);
      const signed = CML.Transaction.new(body, block.transaction_witness_sets().get(index), true, block.auxiliary_data_set().get(index));
      const result = { body, signed, inclusion };
      cache.set(hash, result);
      return result;
    }
    const { body, signed, inclusion } = await canonical(request.transaction);
    const budget = signedBudget(signed);
    const policies = body.mint()?.keys();
    const minted = Array.from({ length: policies?.len() ?? 0 }, (_, index) => policies.get(index).to_hex()).sort();
    const unit = channelUnit(manifest, request.channel);
    let channelIndex;
    const inputs = Array.from({ length: body.inputs().len() }, (_, index) => body.inputs().get(index))
      .sort((a, b) => a.transaction_id().to_hex().localeCompare(b.transaction_id().to_hex()) || Number(a.index() - b.index()));
    for (const [index, input] of inputs.entries()) {
      const parent = await canonical(input.transaction_id().to_hex());
      const output = parent.body.outputs().get(Number(input.index()));
      const quantity = output.amount().multi_asset()?.get(CML.ScriptHash.from_hex(unit.slice(0, 56)), CML.AssetName.from_hex(unit.slice(56)));
      if (quantity === 1n) {
        assert.equal(channelIndex, undefined, 'Duplicate channel input');
        channelIndex = index;
      }
    }
    assert.notEqual(channelIndex, undefined, 'Selected channel is not spent by this transaction');
    const channelRedeemer = budget.redeemers.find(item => item.purpose === 0 && item.index === channelIndex);
    assert.ok(channelRedeemer, 'Actual channel spending redeemer is missing');
    const decoded = await decodeSpendChannelRedeemer(channelRedeemer.data, lucid);
    assert.ok(decoded.ChanUpgrade, 'Transaction is not a channel upgrade');
    const step = Object.keys(decoded.ChanUpgrade.step)[0];
    assert.equal(step, request.step, 'Accepted transaction executes a different upgrade stage');
    const verifierIndex = minted.indexOf(manifest.validators.verify_proof.script_hash);
    const verifier = budget.redeemers.find(item => item.purpose === 1 && item.index === verifierIndex);
    const proofRequired = !['InitUpgrade', 'FlushUpgrade'].includes(step) &&
      !(step === 'CancelUpgrade' && decoded.ChanUpgrade.step.CancelUpgrade.error_receipt === null);
    assert.equal(Boolean(verifier), proofRequired, 'Proof verifier execution differs from the requested operation');
    let proofCount = 0, historyWitnessBytes = 0;
    if (verifier) {
      const envelope = lucid.Data.from(verifier.data);
      assert.equal(envelope.index, 0);
      assert.equal(envelope.fields.length, 2);
      const [proof, history] = envelope.fields;
      proofCount = [0, 1].includes(proof.index) ? 1 : proof.index === 2 ? proof.fields[0].length :
        proof.index === 4 ? proof.fields[0].length + proof.fields[1].length : 0;
      if (history.index === 0) historyWitnessBytes = lucid.Data.to(history).length / 2;
      assert.equal(proofCount, ['TryUpgrade', 'AckUpgrade', 'ConfirmUpgrade'].includes(step) ? 2 : 1);
    }
    const response = await fetch(`http://${providers.ogmios}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'upgrade-capacity', method: 'queryLedgerState/protocolParameters' }) });
    assert.ok(response.ok);
    const parameters = (await response.json()).result;
    const limits = { maxTxSize: parameters.maxTransactionSize.bytes,
      memory: parameters.maxExecutionUnitsPerTransaction.memory, steps: parameters.maxExecutionUnitsPerTransaction.cpu };
    assert.deepEqual(limits, { maxTxSize: baseline.limits.maxTxSize, memory: baseline.limits.memory, steps: baseline.limits.steps },
      'Ledger limits differ from the selected deployment fixture');
    assertFits(budget, limits);
    // Recheck inclusion after collecting parent transactions and current limits.
    const live = (await db.query('SELECT block_hash FROM transaction WHERE tx_hash=$1 AND invalid=false', [request.transaction])).rows;
    assert.equal(live.length, 1);
    assert.equal(live[0].block_hash, inclusion.block_hash);
    console.log(JSON.stringify({ format: 'ledger-accepted-channel-upgrade-budget-v1', genesisSha256: providers.genesisSha256,
      deploymentId: manifest.deployment_id, step, channel: request.channel, inclusion, limits, ...budget,
      proofCount, proofEnvelopeBytes: verifier?.dataBytes ?? 0, historyWitnessBytes,
      flushedLanes: step === 'FlushUpgrade' ? decoded.ChanUpgrade.step.FlushUpgrade.lanes : 0,
      signedCbor: signed.to_cbor_hex(),
      sizeSource: 'Signed envelope reconstructed from authenticated block body, witnesses and auxiliary data. Member encodings are retained.',
      executionSource: 'Aggregate declared units for every redeemer, including proof verification. These bounds were enforced during actual ledger acceptance.' },
    (_, item) => typeof item === 'bigint' ? item.toString() : item));
  } finally { await db.end(); }
}

module.exports = { signedBudget, assertFits };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
