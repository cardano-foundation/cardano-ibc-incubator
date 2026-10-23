// Capture a valid SDK packet proof and build an explicit Gateway control request.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const { MerkleProof } = dependency('@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment')
const { CommitmentProof } = dependency('@cardano-ibc/proto-types/build/cosmos/ics23/v1/proofs')
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')

async function main() {
  const [runtimeArg, specificationArg, outputArg] = process.argv.slice(2)
  const runtime = fs.realpathSync(runtimeArg)
  assert(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep))
  const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
  assert.equal(profile.runtime, runtime)
  const output = path.resolve(outputArg)
  assert(output.startsWith(runtime + path.sep) && !fs.existsSync(output))
  const specification = JSON.parse(fs.readFileSync(specificationArg))
  assert(['receive', 'prune'].includes(specification.kind))
  const packet = specification.packet
  assert.equal(packet.source_port, 'transfer')
  assert.equal(packet.destination_port, 'transfer')
  assert.match(packet.source_channel, /^channel-[0-9]+$/)
  assert.match(packet.sequence, /^[1-9][0-9]*$/)
  const base = `http://127.0.0.1:${profile.ports.cosmos_rpc}`
  const rpc = async (method, parameters = {}) => {
    const response = await fetch(`${base}/${method}?${new URLSearchParams(parameters)}`, { signal: AbortSignal.timeout(30000) })
    assert(response.ok)
    const value = await response.json()
    assert(!value.error, JSON.stringify(value.error))
    return value.result
  }
  const status = await rpc('status')
  const chain = status.node_info.network
  assert.equal(chain, profile.active_chain_id ?? profile.old_chain_id)
  const height = BigInt(status.sync_info.latest_block_height)
  assert(height >= 2n)
  const header = await rpc('commit', { height: height.toString() })
  const key = `commitments/ports/${packet.source_port}/channels/${packet.source_channel}/sequences/${packet.sequence}`
  const query = await rpc('abci_query', { path: '"/store/ibc/key"', data: '0x' + Buffer.from(key).toString('hex'),
    height: (height - 1n).toString(), prove: 'true' })
  assert.equal(query.response.code, 0)
  assert.equal(query.response.height, (height - 1n).toString())
  assert.equal(Boolean(query.response.value), specification.kind === 'receive')
  if (specification.kind === 'receive') {
    const sha = bytes => createHash('sha256').update(bytes).digest()
    const u64 = value => {
      const bytes = Buffer.alloc(8)
      bytes.writeBigUInt64BE(BigInt(value))
      return bytes
    }
    const commitment = sha(Buffer.concat([u64(packet.timeout_timestamp), u64(packet.timeout_height.revision_number),
      u64(packet.timeout_height.revision_height), sha(Buffer.from(packet.data, 'base64'))]))
    assert.equal(Buffer.from(query.response.value, 'base64').toString('hex'), commitment.toString('hex'))
  }
  const proofs = query.response.proofOps.ops.map(op => CommitmentProof.decode(Buffer.from(op.data, 'base64')))
  assert.equal(proofs.length, 2)
  const proof = Buffer.from(MerkleProof.encode({ proofs }).finish()).toString('base64')
  const bridge = path.join(runtime, profile.bridge_directory ?? 'bridge')
  const wallet = JSON.parse(fs.readFileSync(path.join(bridge, 'funding-confirmed.json'))).wallet
  const actualHeight = { revision_number: chain.split('-').at(-1), revision_height: height.toString() }
  const common = { signer: CML.Address.from_bech32(wallet).to_hex(), proof_height: specification.declared_height ?? actualHeight }
  const request = { method: specification.kind === 'receive' ? 'RecvPacket' : 'PrunePacketHistory',
    message: specification.kind === 'receive' ? { ...common, packet, proof_commitment: proof }
      : { ...common, port_id: packet.destination_port, channel_id: packet.destination_channel,
        sequence: packet.sequence, proof_commitment_absence: proof },
    capture: { kind: specification.kind, key, actual_height: actualHeight, header, query },
    ...(specification.expect_error ? { expect_error: specification.expect_error } : {}) }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-packet-proof-'))
  try {
    const candidate = path.join(temporary, 'request.json')
    fs.writeFileSync(candidate, JSON.stringify(request))
    const source = path.join(temporary, 'main.go')
    fs.copyFileSync(path.join(__dirname, 'verify-packet-proof.go.tmpl'), source)
    request.capture.reference_verification = JSON.parse(execFileSync('go', ['run', '-mod=readonly', source, candidate], {
      cwd: path.join(root, 'cosmos/cardano-probabilistic-light-client-v8'),
      env: { ...process.env, GOTOOLCHAIN: 'go1.26.9', GOWORK: 'off' }, encoding: 'utf8',
    }))
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  fs.writeFileSync(output, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output, kind: specification.kind, actual_height: actualHeight, declared_height: common.proof_height }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
