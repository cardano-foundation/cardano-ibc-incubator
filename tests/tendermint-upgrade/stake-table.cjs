const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const dependency = createRequire(path.resolve(__dirname, '../../cardano/gateway/package.json'))
const { CML } = dependency('@lucid-evolution/lucid')
const snapshot = JSON.parse(fs.readFileSync(process.argv[2]))
const table = {}
for (const row of snapshot.pools) {
  assert.match(row.poolId, /^[0-9a-f]{56}$/)
  const stake = Number(row.stake)
  assert(Number.isSafeInteger(stake) && stake > 0)
  // The ledger snapshot uses the raw pool hash. Mithril and the client use
  // its pool-prefixed bech32 representation. The stake itself is unchanged.
  const pool = CML.Ed25519KeyHash.from_hex(row.poolId).to_bech32('pool')
  assert(!(pool in table))
  table[pool] = stake
}
assert.equal(Object.values(table).reduce((a, b) => a + b, 0), Number(snapshot.totalActiveStake))
process.stdout.write(JSON.stringify(table) + '\n')
