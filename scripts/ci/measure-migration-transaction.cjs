#!/usr/bin/env node
/** Read-only measurement of a canonically accepted owned-devnet transaction. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { authenticateBlock } = require('./authenticate-migration-block.cjs');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'cardano/gateway/package.json'));
const { Client } = req('pg');
const CML = req('@dcspark/cardano-multiplatform-lib-nodejs');
const { MiniProtocalsService } = req('./dist/shared/modules/mini-protocals/mini-protocals.service.js');

async function main() {
  const [runtimeArg, txHash, outputArg] = process.argv.slice(2);
  if (!runtimeArg || !/^[0-9a-f]{64}$/.test(txHash || '') || !outputArg) {
    throw new Error('Usage: node scripts/ci/measure-migration-transaction.cjs OWNED_RUNTIME TX_HASH NEW_REPORT_JSON');
  }
  const runtime = fs.realpathSync(runtimeArg);
  const output = path.resolve(outputArg);
  if (!runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep) ||
      !output.startsWith(path.join(root, '.deployment-smoke') + path.sep)) {
    throw new Error('Explicit disposable runtime and output artifact required');
  }
  const rawGenesis = fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json'));
  const genesis = JSON.parse(rawGenesis);
  if (genesis.networkMagic !== 42) throw new Error('Only owned magic-42 rehearsal data is supported');
  const result = JSON.parse(fs.readFileSync(path.join(runtime, 'result.json')));
  if (result.networkRuntime !== runtime || !/^cardano-deployment-test-[a-z0-9]+$/.test(result.project))
    throw new Error('Runtime/project provenance differs from deployment result');
  const compose = ['compose', '-p', result.project, '-f', path.join(runtime, 'compose.json')];
  const docker = args => execFileSync('docker', [...compose, ...args]);
  if (!docker(['exec', '-T', 'node', 'cat', '/runtime/genesis-shelley.json']).equals(rawGenesis))
    throw new Error('Actual provider genesis differs from selected fixture');
  for (const [service, internal, external] of [['history-db', '5432', '27432'], ['yaci', '8080', '29083']]) {
    if (docker(['port', service, internal]).toString().trim() !== `127.0.0.1:${external}`)
      throw new Error('History endpoint is not owned by selected runtime');
  }
  const limits = JSON.parse(fs.readFileSync(path.join(runtime, 'protocol-parameters.json')));
  const db = new Client({ host: '127.0.0.1', port: 27432, database: 'migration_yaci', user: 'postgres' });
  await db.connect();
  try {
    const query = `SELECT t.tx_index, t.block, t.block_hash, b.slot
      FROM transaction t JOIN block b ON b.number=t.block AND b.hash=t.block_hash
      WHERE t.tx_hash=$1 AND t.invalid=false`;
    const rows = (await db.query(query, [txHash])).rows;
    if (rows.length !== 1) throw new Error('Transaction has no unique canonical valid inclusion');
    const inclusion = rows[0];
    const fetcher = new MiniProtocalsService({}, { get: key => key === 'yaciStoreEndpoint' ? 'http://127.0.0.1:29083' : undefined }, console);
    const bytes = await fetcher.fetchBlockCbor({ hash: inclusion.block_hash, slotNo: BigInt(inclusion.slot) });
    const block = authenticateBlock(bytes, inclusion.block_hash);
    const index = Number(inclusion.tx_index);
    if (!Number.isSafeInteger(index) || index < 0 || block.invalid_transactions().includes(index)) throw new Error('Invalid transaction index');
    const body = block.transaction_bodies().get(index);
    const witnesses = block.transaction_witness_sets().get(index);
    if (CML.hash_transaction(body).to_hex() !== txHash) throw new Error('Canonical transaction body hash mismatch');
    const auxiliary = block.auxiliary_data_set().get(index);
    const auxiliaryHash = body.auxiliary_data_hash();
    if (Boolean(auxiliary) !== Boolean(auxiliaryHash) || (auxiliary && CML.hash_auxiliary_data(auxiliary).to_hex() !== auxiliaryHash.to_hex())) {
      throw new Error('Missing or mismatched auxiliary data');
    }
    const tx = CML.Transaction.new(body, witnesses, true, auxiliary);
    const keys = witnesses.vkeywitnesses();
    const signingKeyHashes = [];
    for (let i = 0; keys && i < keys.len(); i++) {
      signingKeyHashes.push(keys.get(i).vkey().hash().to_hex());
    }
    signingKeyHashes.sort();
    const inputs = [];
    for (let i = 0; i < body.inputs().len(); i++) {
      const input = body.inputs().get(i);
      inputs.push({ txHash: input.transaction_id().to_hex(), outputIndex: Number(input.index()) });
    }
    const outputs = [];
    for (let i = 0; i < body.outputs().len(); i++) {
      const output = body.outputs().get(i), value = output.amount(), multi = value.multi_asset();
      const assets = { lovelace: value.coin().toString() }, policies = multi.keys();
      for (let p = 0; p < policies.len(); p++) {
        const policy = policies.get(p), tokens = multi.get_assets(policy), names = tokens.keys();
        for (let n = 0; n < names.len(); n++) {
          const name = names.get(n);
          assets[policy.to_hex() + Buffer.from(name.to_raw_bytes()).toString('hex')] = tokens.get(name).toString();
        }
      }
      outputs.push({ txHash, outputIndex: i, address: output.address().to_bech32(), assets });
    }
    const redeemers = witnesses.redeemers();
    const executions = [];
    if (redeemers) {
      const map = redeemers.as_map_redeemer_key_to_redeemer_val();
      const array = redeemers.as_arr_legacy_redeemer();
      if (map) {
        const keys = map.keys();
        for (let i = 0; i < keys.len(); i++) {
          const key = keys.get(i), value = map.get(key), units = value.ex_units();
          executions.push({ tag: key.tag(), index: key.index().toString(), memory: units.mem().toString(), steps: units.steps().toString() });
        }
      } else if (array) {
        for (let i = 0; i < array.len(); i++) {
          const value = array.get(i), units = value.ex_units();
          executions.push({ tag: value.tag(), index: value.index().toString(), memory: units.mem().toString(), steps: units.steps().toString() });
        }
      } else throw new Error('Unsupported redeemer encoding');
    }
    const sum = field => executions.reduce((total, entry) => total + BigInt(entry[field]), 0n);
    const memory = sum('memory'), steps = sum('steps');
    if (memory > BigInt(limits.maxTxExecutionUnits.memory) || steps > BigInt(limits.maxTxExecutionUnits.steps)) {
      throw new Error('Witness execution units exceed retained rehearsal protocol parameters');
    }
    const latest = (await db.query(query, [txHash])).rows;
    if (latest.length !== 1 || JSON.stringify(latest[0]) !== JSON.stringify(inclusion)) throw new Error('Canonical inclusion changed during measurement');
    const minted = {};
    const mint = body.mint();
    if (mint) {
      const policies = mint.keys();
      for (let p = 0; p < policies.len(); p++) {
        const policy = policies.get(p), assets = mint.get_assets(policy), names = assets.keys();
        for (let a = 0; a < names.len(); a++) {
          const name = names.get(a);
          minted[policy.to_hex() + Buffer.from(name.to_raw_bytes()).toString('hex')] = assets.get(name).toString();
        }
      }
    }
    const report = {
      genesisSha256: createHash('sha256').update(rawGenesis).digest('hex'),
      minted,
      signingKeyHashes,
      bootstrapWitnessCount: witnesses.bootstrap_witnesses()?.len() ?? 0,
      inputs, outputs,
      transaction: txHash, inclusion, memory: memory.toString(), steps: steps.toString(),
      feeLovelace: body.fee().toString(), reconstructedTransactionBytes: tx.to_cbor_bytes().length,
      reconstructionNote: 'Body, witnesses, validity and auxiliary data reconstructed from the canonical block; this is not a claim about the original submitted transaction encoding.',
      limits: { memory: limits.maxTxExecutionUnits.memory, steps: limits.maxTxExecutionUnits.steps, bytes: limits.maxTxSize }, executions,
    };
    if (report.reconstructedTransactionBytes > limits.maxTxSize) throw new Error('Transaction size exceeds retained protocol parameters');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
