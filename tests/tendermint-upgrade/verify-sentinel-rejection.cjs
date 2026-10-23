// Re-evaluate a rejected candidate and identify the actual proof-policy failure.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')
const lucid = dependency('@lucid-evolution/lucid')

async function main() {
  const [runtimeArg, requestArg, diagnosticArg, outputArg] = process.argv.slice(2)
  const runtime = fs.realpathSync(runtimeArg)
  assert(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep))
  const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
  assert.equal(profile.runtime, runtime)
  assert(profile.project.startsWith('cardano-deployment-test-'))
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json')))
    .digest('hex'), profile.genesis_sha256)
  const output = path.resolve(outputArg)
  assert(output.startsWith(runtime + path.sep) && !fs.existsSync(output))
  const diagnostic = JSON.parse(fs.readFileSync(diagnosticArg))
  const request = JSON.parse(fs.readFileSync(requestArg))
  assert(['RecvPacket', 'PrunePacketHistory'].includes(request.method))
  assert.equal(request.capture.reference_verification.sdk_proof_verified, true)
  assert.equal(diagnostic.scope, 'evaluateTx-body')
  const cbor = diagnostic.details.txCbor
  const transaction = CML.Transaction.from_cbor_hex(cbor)
  const policy = JSON.parse(fs.readFileSync(path.join(runtime, profile.bridge_directory ?? 'bridge', 'handler.json')))
    .validators.verifyProof.scriptHash
  const keys = transaction.body().mint().keys()
  const minted = Array.from({ length: keys.len() }, (_, i) => keys.get(i).to_hex()).sort()
  const proofIndex = minted.indexOf(policy)
  assert(proofIndex >= 0, 'Candidate must actually execute the proof policy')
  const { signedBudget } = require(path.join(root, 'scripts/ci/aiken-contract-migration/measure-channel-upgrade.cjs'))
  const redeemer = signedBudget(transaction).redeemers.find(r => r.purpose === 1 && r.index === proofIndex)
  assert(redeemer)
  const decoded = lucid.Data.from(redeemer.data)
  const operation = decoded.fields[0]
  assert.equal(operation.index, request.method === 'RecvPacket' ? 0 : 1)
  assert.equal(operation.fields[1].fields[2].fields[0], Buffer.from('sentinel_root').toString('hex'))
  assert.deepEqual(operation.fields[2].fields, [2n, 1n])
  assert.deepEqual(operation.fields[8].fields[0], ['696263', Buffer.from(request.capture.key).toString('hex')])
  const { MerkleProof } = dependency('@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment')
  const { initializeMerkleProof } = require(path.join(root, 'cardano/gateway/dist/shared/helpers/merkle-proof.js'))
  const { createIcs23MerkleProofSchema } = require(path.join(root, 'cardano/gateway/dist/shared/types/schema-fragments.js'))
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(lucid.Data)
  const wireProof = request.message.proof_commitment ?? request.message.proof_commitment_absence
  const expectedProof = lucid.Data.from(lucid.Data.to(initializeMerkleProof(MerkleProof.decode(Buffer.from(wireProof, 'base64'))), MerkleProofSchema))
  assert.deepEqual(operation.fields[7], expectedProof, 'Candidate must execute the captured SDK proof')
  if (request.method === 'RecvPacket') {
    assert.equal(operation.fields[9], Buffer.from(request.capture.query.response.value, 'base64').toString('hex'))
  }
  const bootstrap = JSON.parse(fs.readFileSync(path.join(runtime, 'observation-bootstrap.json'))).clients[0]
  const references = transaction.body().reference_inputs()
  const referenced = Array.from({ length: references?.len() ?? 0 }, (_, i) => {
    const item = references.get(i)
    return `${item.transaction_id().to_hex()}#${item.index()}`
  })
  assert(referenced.includes(`${bootstrap.transaction_id}#${bootstrap.output_index}`), 'Candidate must reference the actual bootstrap client NFT')
  const response = await fetch(`http://127.0.0.1:${profile.ports['devkit:1337']}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 'sentinel-control', method: 'evaluateTransaction',
      params: { transaction: { cbor } } }),
  })
  const evaluation = await response.json()
  assert.equal(evaluation.error?.code, 3010)
  const failure = evaluation.error.data.find(item => item.validator?.purpose === 'mint' && item.validator.index === proofIndex)
  assert.equal(failure?.error?.code, 3012, 'The actual proof policy must reject the candidate')
  const result = { format: 'local-sentinel-policy-rejection-v1', genesis_sha256: profile.genesis_sha256,
    transaction_hash: CML.hash_transaction(transaction.body()).to_hex(), candidate_cbor: cbor,
    request_method: request.method, captured_sdk_proof_verified: true, bootstrap_client_reference: `${bootstrap.transaction_id}#${bootstrap.output_index}`,
    minted, verifier_policy: policy, verifier_index: proofIndex, verifier_decoded: decoded,
    proof_policy_rejected: true, submitted: false, evaluation }
  fs.writeFileSync(output, JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output, verifier_policy: policy, verifier_index: proofIndex, proof_policy_rejected: true }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
