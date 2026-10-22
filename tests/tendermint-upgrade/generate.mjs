#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../..')
const casesPath = path.join(directory, 'cases.json')
const vectorsPath = path.join(directory, 'vectors.json')
const aikenPath = path.join(root, 'cardano/onchain/validators/client_upgrade_sdk.test.ak')
const profiles = [
  { name: 'v8', version: 'v8.7.0', sdk: 'v0.50.14', upgrade: 'v0.1.4' },
  { name: 'v10', version: 'v10.2.0', sdk: 'v0.53.3', upgrade: 'v0.2.0' },
]

function generate(profile) {
  const module = `github.com/cosmos/ibc-go/${profile.name}`
  const replacements = {
    __IBC_GO_MODULE__: module,
    __MERKLE_PATH_CLIENT__: profile.name === 'v8'
      ? 'commitmenttypes.NewMerklePath("upgrade", "upgradedIBCState/100/upgradedClient")'
      : 'commitmenttypes.NewMerklePath([]byte("upgrade"), []byte("upgradedIBCState/100/upgradedClient"))',
    __MERKLE_PATH_CONSENSUS__: profile.name === 'v8'
      ? 'commitmenttypes.NewMerklePath("upgrade", "upgradedIBCState/100/upgradedConsState")'
      : 'commitmenttypes.NewMerklePath([]byte("upgrade"), []byte("upgradedIBCState/100/upgradedConsState"))',
    __KEEPER_SETUP__: profile.name === 'v8'
      ? 'k := clientkeeper.NewKeeper(cdc, ibcKey, nil, nil, uk)'
      : `k := clientkeeper.NewKeeper(cdc, runtime.NewKVStoreService(ibcKey), nil, uk)
         tmModule := tm.NewLightClientModule(cdc, k.GetStoreProvider())
         k.AddRoute(exported.Tendermint, &tmModule)`,
    __KEEPER_UPGRADE__: profile.name === 'v8'
      ? 'k.UpgradeClient(cacheCtx, clientID, proposed, kernel, cdc.MustMarshal(&clientProof), cdc.MustMarshal(&consensusProof))'
      : 'k.UpgradeClient(cacheCtx, clientID, cdc.MustMarshal(proposed), cdc.MustMarshal(kernel), cdc.MustMarshal(&clientProof), cdc.MustMarshal(&consensusProof))',
    __EXPECTED__: `tc.${profile.name.toUpperCase()}`,
  }
  let source = readFileSync(path.join(directory, 'generator.go.tmpl'), 'utf8')
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to)
  const temporary = mkdtempSync(path.join(tmpdir(), 'tendermint-upgrade-'))
  try {
    const sourcePath = path.join(temporary, 'main.go')
    writeFileSync(sourcePath, source)
    const output = execFileSync('go', ['run', '-mod=readonly', sourcePath, casesPath], {
      cwd: path.join(root, `cosmos/cardano-probabilistic-light-client-${profile.name}`),
      env: { ...process.env, GOTOOLCHAIN: 'go1.26.9', GOWORK: 'off' },
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    })
    const result = JSON.parse(output)
    const expected = {
      [module]: profile.version,
      'github.com/cosmos/cosmos-sdk': profile.sdk,
      'cosmossdk.io/x/upgrade': profile.upgrade,
    }
    for (const [name, version] of Object.entries(expected)) {
      if (result.versions[name] !== version) {
        throw new Error(`${profile.name}: ${name}@${result.versions[name]}, expected ${version}`)
      }
    }
    return result
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

const hex = value => `#"${value}"`
const utf8 = value => hex(Buffer.from(value).toString('hex'))
const height = (revision, value) => `Height { revision_number: ${revision}, revision_height: ${value} }`
const array = values => `[${values.join(', ')}]`

function client(c) {
  return `ClientState {
    chain_id: ${utf8(c.chain_id)},
    trust_level: UncheckedRational { numerator: ${c.trust_numerator}, denominator: ${c.trust_denominator} },
    trusting_period: ${c.trusting_period}, unbonding_period: ${c.unbonding_period}, max_clock_drift: ${c.max_clock_drift},
    frozen_height: ${height(c.frozen_revision, c.frozen_height)}, latest_height: ${height(c.revision, c.height)},
    proof_specs: [proofs.iavl_spec(), proofs.tendermint_spec()],
    upgrade_path: ${array((c.upgrade_path ?? []).map(utf8))},
  }`
}

function consensus(c) {
  return `ConsensusState { timestamp: ${c.timestamp}, root: MerkleRoot { hash: ${hex(c.root)} }, next_validators_hash: ${hex(c.next_validators_hash)} }`
}

function proof(p) {
  return `MerkleProof { proofs: ${array(p.proofs.map(e => `CommitmentProof {
    proof: CommitmentProof_Exist { exist: ExistenceProof {
      key: ${hex(e.key)}, value: ${hex(e.value)},
      leaf: LeafOp { hash: ${e.leaf.hash}, prehash_key: ${e.leaf.prehash_key}, prehash_value: ${e.leaf.prehash_value}, length: ${e.leaf.length}, prefix: ${hex(e.leaf.prefix)} },
      path: ${array(e.path.map(op => `InnerOp { hash: ${op.hash}, prefix: ${hex(op.prefix)}, suffix: ${hex(op.suffix)} }`))},
    } },
  }`))} }`
}

function render(results) {
  const declarations = []
  const interned = new Map()
  const tests = []
  function intern(type, expression) {
    const key = `${type}:${expression}`
    if (!interned.has(key)) {
      const name = `sdk_fixture_${interned.size}`
      declarations.push(`fn ${name}() -> ${type} { ${expression} }`)
      interned.set(key, `${name}()`)
    }
    return interned.get(key)
  }
  for (const profile of profiles) {
    for (const c of results[profile.name].cases) {
      const old = intern('ClientState', client(c.old_client))
      const proposed = intern('ClientState', client(c.proposed_client))
      const trusted = intern('ConsensusState', consensus(c.trusted_consensus))
      const kernel = intern('ConsensusState', consensus(c.kernel))
      const pc = intern('MerkleProof', proof(c.client_proof))
      const ps = intern('MerkleProof', proof(c.consensus_proof))
      const setup = `let (before, after, u) = fixture(${old}, ${trusted}, ${proposed}, ${kernel}, ${pc}, ${ps}, ${c.now})`
      let checks = ''
      if (c.aiken_accepted) {
        // The only accepted output difference is v10's documented scaling.
        const expected = { ...c.reference_client }
        if (profile.name === 'v10' && c.mutation === 'committed_reduced_unbonding') {
          expected.trusting_period = c.old_client.trusting_period
        }
        checks = `expect after.state.client_state == ${intern('ClientState', client(expected))}
          expect after.state.consensus_states == [Pair(after.state.client_state.latest_height, ${intern('ConsensusState', consensus(c.reference_consensus))})]
          expect upgrade_pb.client(u.client_state) == ${hex(c.committed_client)}
          expect upgrade_pb.consensus(u.consensus_state) == ${hex(c.committed_consensus)}
          expect upgrade.verify(before, after, u, ${c.now})
          let (tx, envelope) = transaction_fixture(before, after, u, ${c.now})
          expect verifying_proof.verify_proof.mint(envelope, "proof", tx)
          recover_client.recover_client.withdraw("host", "proof", UpgradeClientWithdrawal { subject_token: before.token }, address.Script("recovery"), tx)`
      } else {
        checks = `expect upgrade.verify(before, after, u, ${c.now})`
      }
      tests.push(`${c.difference ? `// ${c.difference}\n` : ''}test sdk_upgrade_${profile.name}_${c.name}()${c.aiken_accepted ? '' : ' fail'} {
        ${setup}
        ${checks}
      }`)
      if (c.name === 'revision_reset') {
        for (const membership of [true, false]) {
          tests.push(`test sdk_upgrade_${profile.name}_sentinel_rejects_${membership ? 'membership' : 'nonmembership'}() fail {
            ${setup}
            expect upgrade.verify(before, after, u, ${c.now})
            expect [Pair(h, cons)] = after.state.consensus_states
            expect client_state.${membership ? 'verify_membership' : 'verify_non_membership'}(
              after.state.client_state, cons, h, ${c.now}, 1, ${c.now}, 1, 0, 0,
              u.proof_client, MerklePath { key_path: ["upgrade", "upgradedIBCState/100/upgradedClient"] }${membership ? `, ${hex(c.committed_client)}` : ''},
            )
          }`)
        }
      }
    }
  }
  return `// Generated by tests/tendermint-upgrade/generate.mjs. Do not edit.
// SDK store proofs and keeper outcomes are pinned in vectors.json.
use aiken/collection/list
use aiken/interval
use cardano/address
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Mint, Output, OutputReference, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum, ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_redeemer.{UpgradeClient, UpgradeClientWithdrawal}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/upgrade_pb
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{UncheckedRational}
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{VerifyClientUpgrade, VerifyProofEnvelope}
use ibc/client/ics_007_tendermint_client/upgrade.{Upgrade}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath, MerkleProof, MerkleRoot}
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use recover_client
use verifying_proof

fn fixture(old: ClientState, trusted: ConsensusState, proposed: ClientState, kernel: ConsensusState, pc: MerkleProof, ps: MerkleProof, now: Int) -> (ClientDatum, ClientDatum, Upgrade) {
  let before = ClientDatum {
    token: AuthToken { policy_id: "sdk-client-policy", name: "client-0" }, history_root: tree.empty_hash,
    state: ClientDatumState {
      client_state: old, consensus_states: [Pair(old.latest_height, trusted)],
      processed_times: [Pair(old.latest_height, now)], processed_heights: [Pair(old.latest_height, 1)],
    },
  }
  let next = ClientState { ..proposed, trust_level: old.trust_level, trusting_period: old.trusting_period, max_clock_drift: old.max_clock_drift, frozen_height: Height { revision_number: 0, revision_height: 0 } }
  let after = ClientDatum {
    ..before,
    state: ClientDatumState {
      client_state: next, consensus_states: [Pair(next.latest_height, ConsensusState { ..kernel, root: MerkleRoot { hash: "sentinel_root" } })],
      processed_times: [Pair(next.latest_height, now)], processed_heights: [Pair(next.latest_height, client_datum.processed_height_from_time(now))],
    },
  }
  (before, after, Upgrade { client_state: proposed, consensus_state: kernel, proof_client: pc, proof_consensus: ps, history_siblings: [] })
}

fn transaction_fixture(before: ClientDatum, next: ClientDatum, u: Upgrade, now: Int) -> (Transaction, VerifyProofEnvelope) {
  let siblings = list.repeat(tree.empty_hash, tree.merkle_depth_bits)
  let after = ClientDatum { ..next, history_root: consensus_history.insert(before.history_root, consensus_history.from_client(before), siblings) }
  let envelope = VerifyProofEnvelope {
    proof: VerifyClientUpgrade { input: before, output: after, upgrade: Upgrade { ..u, history_siblings: siblings } }, history_witness: None,
  }
  let reference = OutputReference { transaction_id: "transaction", output_index: 0 }
  let output = Output { address: address.from_script("client"), value: assets.from_asset(before.token.policy_id, before.token.name, 1), datum: InlineDatum(before), reference_script: None }
  let raw_spend: Data = UpgradeClient
  let raw_proof: Data = envelope
  (Transaction {
    ..transaction.placeholder, inputs: [Input { output_reference: reference, output }], outputs: [Output { ..output, datum: InlineDatum(after) }],
    mint: assets.from_asset("proof", "", 1), validity_range: interval.between(now / 1_000_000 - 1000, now / 1_000_000),
    redeemers: [Pair(Spend(reference), raw_spend), Pair(Mint("proof"), raw_proof)],
  }, envelope)
}

${declarations.join('\n\n')}

${tests.join('\n\n')}
`
}

const mode = process.argv[2]
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node tests/tendermint-upgrade/generate.mjs --write|--check')
}
const cases = JSON.parse(readFileSync(casesPath, 'utf8'))
const names = new Set()
for (const c of cases) {
  if (!/^[a-z][a-z0-9_]*$/.test(c.name) || names.has(c.name)) throw new Error('Invalid or duplicate case name')
  names.add(c.name)
  for (const field of ['v8', 'v10', 'aiken']) {
    if (typeof c[field] !== 'boolean') throw new Error(`${c.name}: missing ${field} expectation`)
  }
  if ((c.v8 !== c.aiken || c.v10 !== c.aiken) && !c.difference) {
    throw new Error(`${c.name}: unexplained acceptance difference`)
  }
}
const results = {}
for (const profile of profiles) {
  results[profile.name] = generate(profile)
  if (results[profile.name].cases.length !== cases.length) throw new Error('Missing generated cases')
}
const temporary = mkdtempSync(path.join(tmpdir(), 'tendermint-upgrade-aiken-'))
try {
  const formatted = path.join(temporary, 'client_upgrade_sdk.test.ak')
  writeFileSync(formatted, render(results))
  // Match the repository's formatter version. The compiler is pinned separately.
  execFileSync(process.env.AIKEN_FORMATTER ?? 'aiken', ['fmt', formatted], { stdio: 'inherit' })
  for (const [file, contents] of [
    [vectorsPath, `${JSON.stringify(results, null, 2)}\n`],
    [aikenPath, readFileSync(formatted, 'utf8')],
  ]) {
    if (mode === '--write') writeFileSync(file, contents)
    else if (readFileSync(file, 'utf8') !== contents) throw new Error(`${path.relative(root, file)} is stale`)
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
console.log(`${mode === '--write' ? 'Generated' : 'Verified'} ${cases.length} SDK upgrade cases per profile`)
