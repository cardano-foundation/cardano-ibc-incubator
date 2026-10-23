// Build an explicit local-fixture message. Submission requires --submit.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const grpc = dependency('@grpc/grpc-js')
const loader = dependency('@grpc/proto-loader')
const CML = dependency('@dcspark/cardano-multiplatform-lib-nodejs')

async function main() {
  const [runtimeArg, inputArg, outputArg, action] = process.argv.slice(2)
  const runtime = fs.realpathSync(runtimeArg)
  assert(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep))
  const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
  assert.equal(profile.runtime, runtime)
  assert(profile.project.startsWith('cardano-deployment-test-'))
  const genesis = fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json'))
  assert.equal(createHash('sha256').update(genesis).digest('hex'), profile.genesis_sha256)
  assert.equal(JSON.parse(genesis).networkMagic, 42)
  const output = path.resolve(outputArg)
  assert(output.startsWith(runtime + path.sep) && !fs.existsSync(output))
  assert(action === undefined || action === '--submit')
  const request = JSON.parse(fs.readFileSync(inputArg))
  assert(['Transfer', 'RecvPacket', 'Timeout', 'PrunePacketHistory', 'UpgradeClient', 'ChannelOpenAck'].includes(request.method))
  assert(!(request.expect_error && action === '--submit'))
  const protoRoot = path.join(root, 'proto-types/protos/ibc-go')
  const cardano = request.method === 'PrunePacketHistory'
  const clientMessage = request.method === 'UpgradeClient'
  const definition = loader.loadSync(path.join(protoRoot, cardano ? 'ibc/cardano/v1/tx.proto'
    : clientMessage ? 'ibc/core/client/v1/tx.proto' : 'ibc/core/channel/v1/tx.proto'),
    { keepCase: true, longs: String, enums: String, bytes: Buffer, includeDirs: [protoRoot] })
  const ibc = grpc.loadPackageDefinition(definition).ibc
  const Msg = cardano ? ibc.cardano.v1.CardanoMsg : clientMessage ? ibc.core.client.v1.Msg : ibc.core.channel.v1.Msg
  const client = new Msg(`127.0.0.1:${profile.ports.gateway_grpc}`, grpc.credentials.createInsecure(),
    { 'grpc.max_receive_message_length': 64 * 1024 * 1024 })
  const report = { format: 'local-upgrade-gateway-transaction-v1', request }
  try {
    const message = { ...request.message }
    for (const key of ['proof_commitment', 'proof_unreceived', 'proof_commitment_absence', 'proof_upgrade_client', 'proof_upgrade_consensus_state', 'proof_try']) {
      if (message[key]) message[key] = Buffer.from(message[key], 'base64')
    }
    for (const key of ['client_state', 'consensus_state']) {
      if (message[key]) message[key] = { ...message[key], value: Buffer.from(message[key].value, 'base64') }
    }
    if (message.packet) message.packet = { ...message.packet, data: Buffer.from(message.packet.data, 'base64') }
    let response
    try {
      response = await new Promise((resolve, reject) => client[request.method](message,
        { deadline: Date.now() + 180000 }, (error, result) => error ? reject(error) : resolve(result)))
    } catch (error) {
      report.error = { code: error.code, details: error.details }
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
      assert(request.expect_error, error.message)
      assert.match(error.details, new RegExp(request.expect_error, 'i'))
      console.log(JSON.stringify({ output, error: report.error }))
      return
    }
    assert(!request.expect_error, 'The negative control unexpectedly built a valid transaction')
    report.response_type_url = response.unsigned_tx.type_url ?? ''
    report.result = response.result
    const unsigned = Buffer.from(response.unsigned_tx.value).toString('utf8')
    assert(/^(?:[0-9a-f]{2})+$/i.test(unsigned), 'Expected Gateway unsigned CBOR as UTF-8 hex')
    report.unsigned_cbor = unsigned
    const tx = CML.Transaction.from_cbor_hex(unsigned)
    const hash = CML.hash_transaction(tx.body())
    report.transaction_hash = hash.to_hex()
    if (action === '--submit') {
      const defaults = fs.readFileSync(path.join(root, 'cardano/offchain/.env.default'), 'utf8')
      const fixture = defaults.match(/ed25519(?:e)?_sk[0-9a-z]+/)[0]
      const key = CML.PrivateKey.from_bech32(fixture)
      const witnesses = tx.witness_set()
      const vkeys = witnesses.vkeywitnesses() ?? CML.VkeywitnessList.new()
      vkeys.add(CML.make_vkey_witness(hash, key))
      witnesses.set_vkeywitnesses(vkeys)
      const signed = CML.Transaction.new(tx.body(), witnesses, true, tx.auxiliary_data())
      report.signed_cbor = signed.to_cbor_hex()
      // Retain the signed candidate before the one permitted submission.
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
      const response = await fetch(`http://127.0.0.1:${profile.ports['devkit:1337']}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'submitTransaction',
          params: { transaction: { cbor: report.signed_cbor } }, id: 'upgrade-rehearsal' }),
        signal: AbortSignal.timeout(60000),
      })
      report.submission = await response.json()
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
      assert(!report.submission.error, JSON.stringify(report.submission.error))
      assert.equal(report.submission.result.transaction.id, report.transaction_hash)
    } else {
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    }
    console.log(JSON.stringify({ output, transaction_hash: report.transaction_hash,
      response_type_url: report.response_type_url, submitted: action === '--submit' }))
  } finally { client.close() }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
