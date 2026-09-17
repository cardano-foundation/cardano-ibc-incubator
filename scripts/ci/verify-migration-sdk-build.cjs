#!/usr/bin/env node
// Read-only construction against the actual populated successor. No keys,
// signing or submission; the real Ogmios evaluates the actual scripts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { validateSdkRehearsal } = require('./owned-sdk-rehearsal.cjs');

async function main() {
  const [runtimeArg, artifactsArg] = process.argv.slice(2);
  if (!runtimeArg || !artifactsArg) throw new Error('Usage: verify-migration-sdk-build.cjs RUNTIME ARTIFACTS');
  const root = path.resolve(__dirname, '../..');
  const { artifacts, manifest, population, genesisSha256 } = validateSdkRehearsal(runtimeArg, artifactsArg);
  const realFetch = globalThis.fetch;
  const evaluations = [];
  let rejectEvaluation = false, rejectionAttempts = 0;
  const lucidEntry = require.resolve('@lucid-evolution/lucid', { paths: [path.join(root, 'packages/cardano-ibc-tx-builder-runtime')] });
  const { pathToFileURL } = require('node:url');
  const Lucid = await import(pathToFileURL(path.join(path.dirname(lucidEntry), 'index.js')).href);
  const originalEvaluate = Lucid.Kupmios.prototype.evaluateTx;
  const originalSubmit = Lucid.Kupmios.prototype.submitTx;
  Lucid.Kupmios.prototype.submitTx = async () => { throw new Error('This check must never submit a transaction'); };
  Lucid.Kupmios.prototype.evaluateTx = async function(transaction, additionalUTxOs) {
    assert.equal(additionalUTxOs, undefined, 'Standalone SDK must resolve its inputs from the ledger');
    if (rejectEvaluation) {
      rejectionAttempts++;
      throw new Error('Deliberate ledger-evaluator rejection control');
    }
    const record = { transaction, genesisSha256, deploymentId: manifest.deployment_id, generation: manifest.migration.generation };
    try {
      const result = await originalEvaluate.call(this, transaction);
      record.budgets = result;
      evaluations.push(result);
      return result;
    } catch (error) { record.error = String(error); throw error; }
    finally {
      const id = require('node:crypto').randomUUID();
      fs.writeFileSync(path.join(artifacts, `sdk-ledger-evaluation-${id}.json`), JSON.stringify(record, null, 2));
    }
  };
  try {
    const { createTxBuilderRuntime } = require('../../packages/cardano-ibc-tx-builder-runtime/dist');
    const status = await (await realFetch('http://127.0.0.1:28757/status')).json();
    const destinationTime = Date.parse(status.result.sync_info.latest_block_time);
    assert.ok(Number.isFinite(destinationTime));
    const config = {
      bridgeManifestUrl: 'https://rehearsal.invalid/verified-manifest',
      kupmiosUrl: 'http://127.0.0.1:2742,http://127.0.0.1:2637',
      fetchImpl: async (url, options) => String(url) === 'https://rehearsal.invalid/verified-manifest'
        ? new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
        : globalThis.fetch(url, options),
    };
    const request = {
      source_port: 'transfer', source_channel: 'channel-1',
      token: { denom: population.units[1], amount: '1' },
      sender: Lucid.getAddressDetails(population.primary).paymentCredential.hash,
      signer: population.primary,
      receiver: 'cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt',
      timeout_height: { revision_number: '0', revision_height: '0' },
      timeout_timestamp: String(BigInt(destinationTime + 86400000) * 1000000n),
    };
    const result = await createTxBuilderRuntime(config).buildUnsignedTransfer(request);
    assert.ok(evaluations.length > 0, 'Standalone SDK did not call the real ledger evaluator');
    assert.ok(result.unsignedTx.unsignedTxCborHex.length > 0);
    rejectEvaluation = true;
    await assert.rejects(createTxBuilderRuntime(config).buildUnsignedTransfer(request), /Deliberate ledger-evaluator rejection control/);
    assert.equal(rejectionAttempts, 1, 'Do not retry or fall back after ledger evaluation rejects');
    console.log(JSON.stringify({ verified: true, ledgerEvaluations: evaluations.length,
      genesisSha256, deploymentId: manifest.deployment_id, generation: manifest.migration.generation,
      evaluationFailurePropagated: true,
      unsignedBytes: result.unsignedTx.unsignedTxCborHex.length / 2, feeLovelace: result.feeLovelace,
      scope: 'Actual standalone SDK and Ogmios evaluation after V3; unsigned, unsubmitted, no state change' }));
  } finally { Lucid.Kupmios.prototype.evaluateTx = originalEvaluate; Lucid.Kupmios.prototype.submitTx = originalSubmit; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
