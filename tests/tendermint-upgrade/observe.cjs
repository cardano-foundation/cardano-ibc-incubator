// Capture live datum bytes and decoded identities without relying on a Gateway cache.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'))
const lucid = dependency('@lucid-evolution/lucid')
const { decodeClientDatum } = require(path.join(root, 'cardano/gateway/dist/shared/types/client-datum.js'))
const { decodeConnectionDatum } = require(path.join(root, 'cardano/gateway/dist/shared/types/connection/connection-datum.js'))
const { decodeChannelDatum } = require(path.join(root, 'cardano/gateway/dist/shared/types/channel/channel-datum.js'))

async function main() {
  const runtime = fs.realpathSync(process.argv[2])
  assert(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep))
  const profile = JSON.parse(fs.readFileSync(path.join(runtime, 'upgrade-profile.json')))
  assert.equal(profile.runtime, runtime)
  const bridge = path.join(runtime, profile.bridge_directory ?? 'bridge')
  const handler = JSON.parse(fs.readFileSync(path.join(bridge, 'handler.json')))
  const base = `http://127.0.0.1:${profile.ports['devkit:1442']}`
  const read = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    assert(response.ok, `Query failed: ${response.status} ${url}`)
    return response.json()
  }
  const records = async (validator, decode) => {
    const rows = await read(`${base}/matches/${handler.validators[validator].address}?unspent`)
    const result = []
    for (const row of rows) {
      assert.equal(row.spent_at, null)
      assert.equal(row.datum_type, 'inline')
      const { datum } = await read(`${base}/datums/${row.datum_hash}`)
      const decoded = await decode(datum, lucid)
      assert.equal(row.value.assets[`${decoded.token.policyId}.${decoded.token.name}`], 1)
      result.push({ ...row, datum, decoded })
    }
    return result
  }
  const clients = await records('spendClient', decodeClientDatum)
  const connections = await records('spendConnection', decodeConnectionDatum)
  const channels = await records('spendChannel', decodeChannelDatum)
  const packet_lanes = []
  if (handler.packetState) {
    const state = handler.packetState.state
    for (const address of new Set([state.address, handler.packetState.guard.address])) {
      for (const row of await read(`${base}/matches/${address}?unspent`)) {
        assert.equal(row.spent_at, null)
        const { datum } = await read(`${base}/datums/${row.datum_hash}`)
        assert(Object.entries(row.value.assets).some(([unit, amount]) => unit.startsWith(state.scriptHash + '.') && amount === 1))
        packet_lanes.push({ ...row, datum, decoded: lucid.Data.from(datum) })
      }
    }
  }
  const funding = JSON.parse(fs.readFileSync(path.join(bridge, 'funding-confirmed.json')))
  const wallet = await read(`${base}/matches/${funding.wallet}?unspent`)
  const cosmosBase = `http://127.0.0.1:${profile.ports.cosmos_rest}/ibc/core`
  const cosmos = {
    clients: await read(`${cosmosBase}/client/v1/client_states`),
    connections: await read(`${cosmosBase}/connection/v1/connections`),
    channels: await read(`${cosmosBase}/channel/v1/channels`),
  }
  const result = { format: 'tendermint-upgrade-observation-v1', genesis_sha256: profile.genesis_sha256,
    clients, connections, channels, packet_lanes, wallet_address: funding.wallet, wallet, cosmos }
  const json = JSON.stringify(result, (_, value) => {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Map) return Array.from(value.entries())
    return value
  }, 2)
  process.stdout.write(json + '\n')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
