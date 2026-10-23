// Convert an authenticated SDK halt capture into the production Gateway message.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const { Any } = dependency('@cardano-ibc/proto-types/build/google/protobuf/any')
const { MerkleProof } = dependency('@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment')
const { CommitmentProof } = dependency('@cardano-ibc/proto-types/build/cosmos/ics23/v1/proofs')
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')

const [runtimeArg, captureArg, outputArg] = process.argv.slice(2)
const runtime = fs.realpathSync(runtimeArg)
assert(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep))
const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
assert.equal(profile.runtime, runtime)
const capture = JSON.parse(fs.readFileSync(captureArg))
assert.equal(capture.header.signed_header.header.chain_id, profile.old_chain_id)
assert.equal(capture.upgrade_height, String(profile.upgrade_height))
assert.equal(capture.reference_verification.keeper_upgrade_accepted, true)
assert.equal(capture.reference_verification.commit_signatures_verified, true)
assert.equal(capture.reference_verification.sdk_membership_proofs_verified, true)
const output = path.resolve(outputArg)
assert(output.startsWith(runtime + path.sep) && !fs.existsSync(output))
const state = name => {
  const any = Any.decode(Buffer.from(capture.proofs[name].response.value, 'base64'))
  return { type_url: any.type_url, value: Buffer.from(any.value).toString('base64') }
}
const proof = name => Buffer.from(MerkleProof.encode({ proofs: capture.proofs[name].response.proofOps.ops
  .map(op => CommitmentProof.decode(Buffer.from(op.data, 'base64'))) }).finish()).toString('base64')
const bridge = path.join(runtime, profile.bridge_directory ?? 'bridge')
const wallet = JSON.parse(fs.readFileSync(path.join(bridge, 'funding-confirmed.json'))).wallet
const request = { method: 'UpgradeClient', message: {
  signer: CML.Address.from_bech32(wallet).to_hex(), client_id: profile.route.cardano_client_id,
  client_state: state('upgradedClient'), consensus_state: state('upgradedConsState'),
  proof_upgrade_client: proof('upgradedClient'), proof_upgrade_consensus_state: proof('upgradedConsState'),
} }
fs.writeFileSync(output, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ output, client_id: request.message.client_id, upgrade_height: capture.upgrade_height }))
