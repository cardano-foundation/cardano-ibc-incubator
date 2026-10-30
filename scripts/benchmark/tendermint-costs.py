#!/usr/bin/env python3
"""Measure complete signed updates using the existing consensus-history fixture.

The derived runners retain the fixture's validators and finalization assertions.
Only the captured header, batch choice and accounting instrumentation change.
The general controls select the supported positive trusted-validator count for
an unchanged header. They are not observations of validator-set churn.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError(f'Fixture anchor changed: {before[:80]}')
    return text.replace(before, after, 1)


def absolute_imports(text, directory):
    return re.sub(r'(from\s+["\'])(\.[^"\']+)(["\'])',
                  lambda match: match[1] + str((directory / match[2]).resolve()) + match[3], text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--deno', default='deno')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    source = root / 'cardano/offchain/scripts'
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    fixture_path = source / 'consensus-history.test.ts'
    helper_path = source / 'consensus-history-staged-fixture.ts'
    fixture = fixture_path.read_text().split('Deno.test("signed staged', 1)[0]
    if fixture == fixture_path.read_text():
        raise RuntimeError('Cannot locate the fixture/test boundary')
    fixture = absolute_imports(fixture, source)
    helper = absolute_imports(helper_path.read_text(), source)
    helper = replace_once(helper, 'const singleSet = adjacent ||',
                          'const singleSet = adjacent || Deno.env.get("TM_COST_GENERAL") !== "1" &&')
    helper = replace_once(helper, 'const batchSize = args.batchSize ?? 6;',
                          'const batchSize = Number(Deno.env.get("TM_COST_BATCH"));')
    helper = replace_once(helper, 'args.resourcePercent ?? 95', 'args.resourcePercent ?? 80')
    helper_out = output / 'session-fixture.ts'
    helper_out.write_text(helper)
    fixture = replace_once(fixture, str(helper_path), str(helper_out))
    first = fixture.index('const adjacentHeader =')
    last = fixture.index('const proofSpecs =', first)
    capacity = root / 'cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity/normalized.json'
    header = '''import capacity from "CAPACITY" with { type: "json" };
const raw = capacity.scenarios.non_adjacent_mixed;
const h = raw.header.signed_header.header;
const commit = raw.header.signed_header.commit;
const c = (fields: Data[]) => new Constr<Data>(0, fields);
const block = (v: typeof h.last_block_id) => c([v.hash, c([BigInt(v.part_set_header.total), v.part_set_header.hash])]);
const val = (v: typeof raw.header.validator_set.validators[number]) => c([v.address, v.pub_key.ed25519, BigInt(v.voting_power), BigInt(v.proposer_priority)]);
const set = (v: typeof raw.header.validator_set) => c([v.validators.map(val), val(v.proposer), BigInt(v.total_voting_power)]);
const adjacentTmHeader = c([c([BigInt(h.version.block), BigInt(h.version.app)]), fromText(h.chain_id), BigInt(h.height), BigInt(h.time), block(h.last_block_id), h.last_commit_hash, h.data_hash, h.validators_hash, h.next_validators_hash, h.consensus_hash, h.app_hash, h.last_results_hash, h.evidence_hash, h.proposer_address]);
const adjacentHeader = c([c([adjacentTmHeader, c([BigInt(commit.height), BigInt(commit.round), block(commit.block_id), commit.signatures.map(v => c([BigInt(v.block_id_flag), v.validator_address, BigInt(v.timestamp), v.signature]))])]), set(raw.header.validator_set), c([1n, BigInt(raw.header.trusted_height.revision_height)]), set(raw.header.trusted_validators)]);
'''.replace('CAPACITY', str(capacity))
    fixture = fixture[:first] + header + fixture[last:]
    fixture = replace_once(fixture, 'emulator.time = adjacentFixture.recommended_emulator_time_ms;',
                           'emulator.time = Math.floor(Number(h.time) / 1e6) + 2000;')
    fixture = replace_once(fixture, 'stagedMode === "non-adjacent" ? 1n : 2n',
                           'BigInt(raw.header.trusted_height.revision_height)')
    fixture = replace_once(fixture, 'BigInt(adjacentFixture.trusted_timestamp_override_ns)',
                           'BigInt(raw.trusted_consensus_state.timestamp)')
    fixture = replace_once(fixture, 'normalUpdate ? "testchain2-1" : "chain-0"',
                           'normalUpdate ? h.chain_id : "chain-0"')
    instrument = '''
import { measureTransaction, stringifyCosts } from "ACCOUNTING";
Deno.test("complete Tendermint update funding", async () => {
  const context = await fixture(0, false, false, true, true, true, false, true, undefined, undefined, "non-adjacent");
  const lucid = context.lucid;
  const emulator = lucid.config().provider! as Emulator;
  const address = await lucid.wallet().address();
  const walletBalance = () => Object.values(emulator.ledger).filter(e => !e.spent && e.utxo.address === address).reduce((n, e) => n + e.utxo.assets.lovelace, 0n);
  const rows: Array<ReturnType<typeof measureTransaction> & { walletBefore: bigint; walletAfter?: bigint }> = [];
  const originalSubmit = emulator.submitTx.bind(emulator);
  const originalBlock = emulator.awaitBlock.bind(emulator);
  let pending: typeof rows[number] | undefined;
  emulator.submitTx = async (cbor) => {
    assert(!pending, "Every measured transaction must be applied before the next");
    const body = CML.Transaction.from_cbor_hex(cbor).body();
    const resolve = (refs: CML.TransactionInputList | undefined) => {
      const result: UTxO[] = [];
      for (let i = 0; refs && i < refs.len(); i++) {
        const input = refs.get(i);
        const entry = emulator.ledger[input.transaction_id().to_hex() + Number(input.index())];
        assert(entry && !entry.spent);
        result.push(entry.utxo);
      }
      return result;
    };
    const observed = {
      ...measureTransaction(cbor, resolve(body.inputs()), resolve(body.collateral_inputs()), BigInt(parameters.coinsPerUtxoByte), u => u.address === address
        ? { name: "relayer", wallet: true, controller: "relayer", recoveryRecipient: "relayer", recoveryCondition: "Payment key" }
        : { name: "protocol-state", controller: "Protocol validators", recoveryRecipient: "Session owner or protocol state", recoveryCondition: "Session reserve returns at finalization. Existing host and client outputs are preserved" }),
      walletBefore: walletBalance(),
    };
    const hash = await originalSubmit(cbor);
    rows.push(observed);
    pending = observed;
    return hash;
  };
  emulator.awaitBlock = (height) => {
    originalBlock(height);
    if (pending) {
      pending.walletAfter = walletBalance();
      assertEquals(pending.walletBefore - pending.walletAfter, pending.roles.relayer.netDebitLovelace, "Relayer wallet reconciliation");
      pending = undefined;
    }
  };
  const before = walletBalance();
  const initialRefs = new Set(Object.keys(emulator.ledger));
  const started = performance.now();
  await context.update();
  const elapsedMs = performance.now() - started;
  assert(!pending);
  const fees = rows.reduce((n, r) => n + r.feeLovelace, 0n);
  const debit = rows.reduce((n, r) => n + r.roles.relayer.netDebitLovelace, 0n);
  const measuredHashes = new Set(rows.map(row => row.transaction));
  const fixtureCredits = Object.entries(emulator.ledger).filter(([key, entry]) =>
    !initialRefs.has(key) && !measuredHashes.has(entry.utxo.txHash)
  ).map(([, entry]) => entry.utxo);
  assertEquals(fixtureCredits.length, 1, "Only the fixture's client reference may be injected during finalization");
  assert(fixtureCredits.every(u => u.address === address && u.scriptRef));
  const fixtureFunding = fixtureCredits.reduce((sum, u) => sum + u.assets.lovelace, 0n);
  assertEquals(before + fixtureFunding - walletBalance(), debit);
  let reserve = 0n, peak = 0n;
  for (const row of rows) {
    reserve += row.roles["protocol-state"]?.netReserveIncreaseLovelace ?? 0n;
    peak = reserve > peak ? reserve : peak;
  }
  await Deno.writeTextFile(Deno.env.get("TM_COST_OUTPUT")!, stringifyCosts({
    name: Deno.env.get("TM_COST_NAME"), transactions: rows, feeLovelace: fees, relayerNetDebitLovelace: debit,
    fixtureReferenceFundingLovelace: fixtureFunding, fixtureReferenceCredits: fixtureCredits,
    peakTemporaryProtocolReserveLovelace: peak, netProtocolReserveIncreaseLovelace: reserve,
    elapsedMs, latencyScope: "Emulator construction, signing and evaluation time. Not network inclusion or ICS-20 delivery latency",
    seededStateScope: "Deployment, reference publication, stake registration and client creation precede measurement. Existing protocol input values are retained in the transaction evidence",
  }), {createNew: true});
});
'''.replace('ACCOUNTING', str(root / 'cardano/offchain/src/relayer-accounting.ts'))
    runner = output / 'update-cost.test.ts'
    runner.write_text(fixture + instrument)
    profiles = []
    for name, general, batch in [('general-6', True, 6), ('unchanged-6', False, 6), ('unchanged-24', False, 24), ('general-24', True, 24)]:
        env = dict(os.environ, TM_COST_NAME=name, TM_COST_GENERAL='1' if general else '0', TM_COST_BATCH=str(batch), TM_COST_OUTPUT=str(output / (name + '.json')))
        env.pop('PACKET_LANE_NODE_URL', None)
        log = output / (name + '.log')
        with log.open('w') as stream:
            subprocess.run([args.deno, 'test', '--config', str(root / 'cardano/offchain/deno.json'), '--allow-env', '--allow-read', '--allow-write', str(runner)], cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)
        profile = json.loads((output / (name + '.json')).read_text())
        profiles.append(profile)
        print(json.dumps({'name': name, 'transactions': len(profile['transactions']), 'feeLovelace': profile['feeLovelace']}), flush=True)
    report = {
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'blueprintSha256': hashlib.sha256((root / 'cardano/onchain/plutus.json').read_bytes()).hexdigest(),
        'sourceHashes': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__).resolve(), fixture_path, helper_path, capacity]},
        'derivedRunnerSha256': hashlib.sha256(runner.read_bytes()).hexdigest(),
        'denoVersion': subprocess.check_output([args.deno, '--version'], text=True).splitlines()[0],
        'scope': 'Same captured signed 45-validator unchanged header and retained fee parameters. The general controls deliberately retain trusted-set reconstruction. No production eligibility or update frequency is inferred',
        'profiles': profiles,
    }
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
