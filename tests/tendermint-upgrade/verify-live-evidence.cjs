// Recheck the retained public rehearsal artifacts without running either chain.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')
const lucid = dependency('@lucid-evolution/lucid')
const { authenticateBlock } = require(path.join(root, 'scripts/ci/aiken-contract-migration/authenticate-migration-block.cjs'))
const { signedBudget, assertFits } = require(path.join(root, 'scripts/ci/aiken-contract-migration/measure-channel-upgrade.cjs'))
const directory = path.resolve(process.argv[2] ?? path.join(__dirname, 'evidence/live-v8-revision-reset'))
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name)))
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item instanceof Map ? [...item.entries()] : item)

async function main() {

  for (const [name, hash] of Object.entries(read('manifest.json').files)) {
    assert.equal(path.basename(name), name)
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex'), hash, name)
  }
  const result = read('result.json')
  assert.equal(result.completed, true)
  for (const [name, value] of Object.entries(result.checks)) assert.equal(value, true, name)
  const receipts = {}
  for (const name of ['baseline-receive', 'halt-header', 'client-upgrade', 'successor-header', 'receive-2', 'prune-1', 'receive-3']) {
    const receipt = read(`${name}-receipt.json`)
    const block = authenticateBlock(Buffer.from(receipt.authenticated_block_cbor, 'hex'), receipt.inclusion.block_hash)
    const index = Number(receipt.inclusion.tx_index)
    assert(!block.invalid_transactions().includes(index))
    const body = block.transaction_bodies().get(index)
    assert.equal(CML.hash_transaction(body).to_hex(), receipt.transaction)
    const tx = CML.Transaction.new(body, block.transaction_witness_sets().get(index), true, block.auxiliary_data_set().get(index))
    assert.equal(tx.to_cbor_hex(), receipt.signed_cbor)
    const budget = signedBudget(tx)
    assertFits(budget, receipt.limits)
    assert.equal(budget.canonicalSignedBytes, receipt.canonicalSignedBytes)
    assert.equal(budget.memory.toString(), receipt.memory)
    assert.equal(budget.cpu.toString(), receipt.cpu)
    const keys = body.mint()?.keys()
    const policies = Array.from({ length: keys?.len() ?? 0 }, (_, i) => keys.get(i).to_hex()).sort()
    const verifier = budget.redeemers.find(r => r.purpose === 1 && r.index === policies.indexOf(receipt.verifier_policy))
    assert.equal(json(verifier ? lucid.Data.from(verifier.data) : null), json(receipt.verifier_decoded))
    receipts[name] = receipt
  }
  assert.equal(receipts['client-upgrade'].verifier_decoded.fields[0].index, 5)
  const { decodeClientDatum } = require(path.join(root, 'cardano/gateway/dist/shared/types/client-datum.js'))
  const before = read('before-upgrade.json')
  for (const [name, observation] of [['client-upgrade', 'bootstrap.json'], ['successor-header', 'authenticated-successor.json']]) {
    const observed = read(observation).clients[0]
    assert.equal(observed.transaction_id, receipts[name].transaction)
    const tx = CML.Transaction.from_cbor_hex(receipts[name].signed_cbor)
    const output = tx.body().outputs().get(Number(observed.output_index))
    const client = await decodeClientDatum(output.datum().as_datum().to_cbor_hex(), lucid)
    assert.equal(output.amount().multi_asset().get(CML.ScriptHash.from_hex(client.token.policyId),
      CML.AssetName.from_raw_bytes(Buffer.from(client.token.name, 'hex'))), 1n)
    assert.equal(json(client), json(observed.decoded))
    assert.equal(json(client.token), json(before.clients[0].decoded.token))
    assert.equal(Buffer.from(client.state.clientState.chainId, 'hex').toString(), result.new_chain_id)
    for (const field of ['trustLevel', 'trustingPeriod', 'maxClockDrift']) {
      assert.equal(json(client.state.clientState[field]), json(before.clients[0].decoded.state.clientState[field]))
    }
    const latest = client.state.clientState.latestHeight
    assert.equal(latest.revisionNumber, 2n)
    assert.equal(latest.revisionHeight, name === 'client-upgrade' ? 1n : BigInt(result.successor_proof_height))
    const consensus = [...client.state.consensusStates.values()][0]
    const expectedRoot = name === 'client-upgrade' ? Buffer.from('sentinel_root').toString('hex')
      : read('sentinel-receive-request.json').capture.header.signed_header.header.app_hash.toLowerCase()
    assert.equal(consensus.root.hash, expectedRoot)
    assert(output.amount().coin() >= BigInt(before.clients[0].value.coins))
  }
  const final = read('final.json')
  for (const kind of ['connections', 'channels']) {
    assert.equal(json(final[kind].map(item => item.decoded)), json(before[kind].map(item => item.decoded)))
  }
  const balance = observation => observation.wallet.reduce((sum, row) => sum + BigInt(row.value.assets[result.voucher_asset_unit] ?? 0), 0n)
  assert.equal(balance(before), 1000n)
  assert.equal(balance(final), 3000n)
  assert.equal(read('sdk-escrow.json').balance.amount, '3000')
  assert.deepEqual(read('final-sdk-commitments.json').commitments, [])
  assert.deepEqual(read('baseline-sdk-commitments.json').commitments.map(item => item.sequence), ['2'])
  const restart = read('revision-restart.json')
  assert.equal(restart.ibc_route_state_preserved, true)
  assert.equal(restart.sdk_handler_applied, true)
  assert.equal(read('sdk-migration.json').applied_plan.height, result.upgrade_height)
  const firstHeader = read('sdk-first-block.json').block.header
  assert.equal(firstHeader.chain_id, result.new_chain_id)
  assert.equal(firstHeader.height, '1')
  assert.equal(firstHeader.validators_hash, read('sdk-upgrade-proof.json').header.signed_header.header.next_validators_hash)
  execFileSync('python3', [path.join(__dirname, 'verify_capture.py'), path.join(directory, 'sdk-upgrade-proof.json')], { cwd: root })

  for (const [kind, receiptName, branch] of [['receive', 'receive-2', 0], ['prune', 'prune-1', 1]]) {
    const negative = read(`sentinel-${kind}-rejection.json`)
    const positive = receipts[receiptName].verifier_decoded.fields[0]
    const rejected = negative.verifier_decoded.fields[0]
    assert.equal(negative.submitted, false)
    assert.equal(negative.proof_policy_rejected, true)
    assert.equal(positive.index, branch)
    assert.equal(rejected.index, branch)
    assert.equal(rejected.fields[1].fields[2].fields[0], Buffer.from('sentinel_root').toString('hex'))
    assert.deepEqual(rejected.fields[2].fields, ['2', '1'])
    assert.deepEqual(positive.fields[2].fields, ['2', result.successor_proof_height])
    assert.deepEqual(positive.fields[7], rejected.fields[7], 'The same SDK proof must succeed after the verified update')
    assert.deepEqual(positive.fields[8], rejected.fields[8])
    assert.equal(negative.evaluation.error.code, 3010)
    assert(negative.evaluation.error.data.some(item => item.validator?.purpose === 'mint' &&
      item.validator.index === negative.verifier_index && item.error.code === 3012))
  }
  for (const sequence of [1, 2, 3]) {
    const ack = read(`packet-${sequence}-acknowledgement.json`)
    assert.equal(ack.tx_result.code, 0)
    assert(ack.tx_result.events.some(event => event.type === 'acknowledge_packet' &&
      event.attributes.some(entry => entry.key === 'packet_sequence' && entry.value === String(sequence))))
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-live-upgrade-'))
  try {
    const source = path.join(temporary, 'main.go')
    fs.copyFileSync(path.join(__dirname, 'verify-packet-proof.go.tmpl'), source)
    for (const kind of ['receive', 'prune']) {
      const verified = JSON.parse(execFileSync('go', ['run', '-mod=readonly', source, path.join(directory, `sentinel-${kind}-request.json`)], {
        cwd: path.join(root, 'cosmos/cardano-probabilistic-light-client-v8'),
        env: { ...process.env, GOTOOLCHAIN: 'go1.26.9', GOWORK: 'off' }, encoding: 'utf8',
      }))
      assert.equal(verified.sdk_proof_verified, true)
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  console.log(JSON.stringify({ verified: true, cardano_transactions: Object.keys(receipts).length,
    sdk_acknowledgements: 3, sentinel_controls: 2, same_proof_positive_controls: 2 }))

}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
