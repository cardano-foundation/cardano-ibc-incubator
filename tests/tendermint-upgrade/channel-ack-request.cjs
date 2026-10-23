// Build the ordinary channel acknowledgement at an already verified client height.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const { MerkleProof } = dependency('@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment')
const { CommitmentProof } = dependency('@cardano-ibc/proto-types/build/cosmos/ics23/v1/proofs')
const { Channel } = dependency('@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel')
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')

async function main() {
  const [runtimeArg, observationArg, outputArg] = process.argv.slice(2)
  const runtime = fs.realpathSync(runtimeArg)
  assert(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep))
  const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
  assert.equal(profile.runtime, runtime)
  const observation = JSON.parse(fs.readFileSync(observationArg))
  assert.equal(observation.genesis_sha256, profile.genesis_sha256)
  assert.equal(observation.clients.length, 1)
  const client = observation.clients[0].decoded.state.clientState
  assert.equal(Buffer.from(client.chainId, 'hex').toString(), profile.old_chain_id)
  const height = client.latestHeight.revisionHeight
  const output = path.resolve(outputArg)
  assert(output.startsWith(runtime + path.sep) && !fs.existsSync(output))
  const rpc = async (method, parameters) => {
    const response = await fetch(`http://127.0.0.1:${profile.ports.cosmos_rpc}/${method}?${new URLSearchParams(parameters)}`)
    assert(response.ok)
    const value = await response.json()
    assert(!value.error, JSON.stringify(value.error))
    return value.result
  }
  const header = await rpc('commit', { height })
  assert.equal(header.signed_header.header.chain_id, profile.old_chain_id)
  const state = observation.clients[0].decoded.state.consensusStates.find(([h]) =>
    h.revisionNumber === client.latestHeight.revisionNumber && h.revisionHeight === height)
  assert(state)
  assert.equal(state[1].root.hash, header.signed_header.header.app_hash.toLowerCase())
  const key = `channelEnds/ports/transfer/channels/${profile.route.cosmos_channel_id}`
  const query = await rpc('abci_query', { path: '"/store/ibc/key"', data: '0x' + Buffer.from(key).toString('hex'),
    height: (BigInt(height) - 1n).toString(), prove: 'true' })
  assert.equal(query.response.code, 0)
  const channel = Channel.decode(Buffer.from(query.response.value, 'base64'))
  assert.equal(channel.state, 2)
  assert.equal(channel.ordering, 1)
  assert.equal(channel.counterparty.port_id, 'transfer')
  assert.equal(channel.counterparty.channel_id, profile.route.cardano_channel_id)
  const proof = MerkleProof.encode({ proofs: query.response.proofOps.ops.map(op => CommitmentProof.decode(Buffer.from(op.data, 'base64'))) }).finish()
  const wallet = JSON.parse(fs.readFileSync(path.join(runtime, profile.bridge_directory ?? 'bridge', 'funding-confirmed.json'))).wallet
  const request = { method: 'ChannelOpenAck', message: {
    port_id: 'transfer', channel_id: profile.route.cardano_channel_id,
    counterparty_channel_id: profile.route.cosmos_channel_id, counterparty_version: channel.version,
    signer: CML.Address.from_bech32(wallet).to_hex(), proof_try: Buffer.from(proof).toString('base64'),
    proof_height: { revision_number: client.latestHeight.revisionNumber, revision_height: height },
  }, capture: { kind: 'channel-ack', proof_kind: 'membership', key, header, query } }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-channel-proof-'))
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
  console.log(JSON.stringify({ output, proof_height: request.message.proof_height }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
