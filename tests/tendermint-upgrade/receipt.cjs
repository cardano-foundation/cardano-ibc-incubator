// Authenticate a real ledger transaction and retain all script execution bounds.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')
const { Client } = dependency('pg')
const helpers = path.join(root, 'scripts/ci/aiken-contract-migration')
const { ownedRuntimeProviders } = require(path.join(helpers, 'owned-runtime-providers.cjs'))
const { authenticateBlock } = require(path.join(helpers, 'authenticate-migration-block.cjs'))
const { signedBudget, assertFits } = require(path.join(helpers, 'measure-channel-upgrade.cjs'))
const { MiniProtocalsService } = require(path.join(root, 'cardano/gateway/dist/shared/modules/mini-protocals/mini-protocals.service.js'))

async function main() {
  const [runtimeArg, transaction, outputArg] = process.argv.slice(2)
  assert.match(transaction, /^[0-9a-f]{64}$/)
  const runtime = fs.realpathSync(runtimeArg)
  const providers = ownedRuntimeProviders(runtime)
  const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
  assert.equal(profile.runtime, runtime)
  assert.equal(providers.genesisSha256, profile.genesis_sha256)
  const output = path.resolve(outputArg)
  assert(output.startsWith(runtime + path.sep) && !fs.existsSync(output))
  const bridge = path.join(runtime, profile.bridge_directory ?? 'bridge')
  const baseline = JSON.parse(fs.readFileSync(path.join(bridge, 'result.json')))
  const handler = JSON.parse(fs.readFileSync(path.join(bridge, 'handler.json')))
  const db = new Client({ host: '127.0.0.1', port: Number(providers.historyDb.split(':')[1]),
    database: 'yaci_store', user: 'yaci', password: 'devkit' })
  await db.connect()
  try {
    const rows = (await db.query('SELECT t.tx_index,t.block,t.block_hash,b.slot FROM transaction t JOIN block b ON b.number=t.block AND b.hash=t.block_hash WHERE t.tx_hash=$1 AND t.invalid=false', [transaction])).rows
    assert.equal(rows.length, 1, 'Expected one valid canonical transaction')
    const inclusion = rows[0]
    const fetcher = new MiniProtocalsService({}, { get: key => key === 'yaciStoreEndpoint' ? `http://${providers.history}` : undefined },
      { log() {}, warn() {}, error() {}, debug() {} })
    const bytes = await fetcher.fetchBlockCbor({ hash: inclusion.block_hash, slotNo: BigInt(inclusion.slot) })
    const block = authenticateBlock(bytes, inclusion.block_hash)
    const index = Number(inclusion.tx_index)
    assert(!block.invalid_transactions().includes(index))
    const body = block.transaction_bodies().get(index)
    assert.equal(CML.hash_transaction(body).to_hex(), transaction)
    const signed = CML.Transaction.new(body, block.transaction_witness_sets().get(index), true, block.auxiliary_data_set().get(index))
    const budget = signedBudget(signed)
    const response = await fetch(`http://${providers.ogmios}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'upgrade-receipt', method: 'queryLedgerState/protocolParameters' }) })
    assert(response.ok)
    const parameters = (await response.json()).result
    const limits = { maxTxSize: parameters.maxTransactionSize.bytes,
      memory: parameters.maxExecutionUnitsPerTransaction.memory, steps: parameters.maxExecutionUnitsPerTransaction.cpu }
    assert.deepEqual(limits, baseline.limits)
    assertFits(budget, limits)
    const policies = body.mint()?.keys()
    const minted = Array.from({ length: policies?.len() ?? 0 }, (_, i) => policies.get(i).to_hex()).sort()
    const verifierIndex = minted.indexOf(handler.validators.verifyProof.scriptHash)
    const verifier = budget.redeemers.find(r => r.purpose === 1 && r.index === verifierIndex)
    const inputs = Array.from({ length: body.inputs().len() }, (_, i) => {
      const input = body.inputs().get(i)
      return `${input.transaction_id().to_hex()}#${input.index()}`
    })
    const lucid = dependency('@lucid-evolution/lucid')
    const outputs = Array.from({ length: body.outputs().len() }, (_, i) => {
      const item = body.outputs().get(i)
      return { index: i, cbor: item.to_cbor_hex(), address: item.address().to_bech32(),
        datum: item.datum()?.as_datum()?.to_cbor_hex() }
    })
    const live = (await db.query('SELECT block_hash FROM transaction WHERE tx_hash=$1 AND invalid=false', [transaction])).rows
    assert.equal(live.length, 1)
    assert.equal(live[0].block_hash, inclusion.block_hash)
    const result = { format: 'ledger-accepted-tendermint-upgrade-receipt-v1', genesis_sha256: providers.genesisSha256,
      inclusion, limits, ...budget, inputs, outputs, minted, verifier_policy: handler.validators.verifyProof.scriptHash,
      verifier_redeemer: verifier?.data, verifier_decoded: verifier ? lucid.Data.from(verifier.data) : null,
      signed_cbor: signed.to_cbor_hex(), authenticated_block_cbor: Buffer.from(bytes).toString('hex'),
      evidence: 'Canonical transaction authenticated against the block body hash. All declared script bounds were enforced by the ledger.' }
    fs.writeFileSync(output, JSON.stringify(result, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output, transaction, block: inclusion.block, signed_bytes: budget.canonicalSignedBytes,
      memory: budget.memory.toString(), cpu: budget.cpu.toString(), proof_policy_executed: Boolean(verifier) }))
  } finally { await db.end() }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
