#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve('cardano/onchain');
const output = resolve(process.argv[2] ?? 'aiken-mutations.json');
const mutations = [
  {
    name: 'registered-client-script', file: 'lib/ibc/utils/validator_utils.ak',
    before: '    registration.spend_validator == "" || output.address.payment_credential == Script(',
    after: '    (registration.spend_validator == "" || True) || output.address.payment_credential == Script(',
    tests: ['prop_registered_client_isolates_same_sequence_instances', 'prop_registered_client_rejects_cross_type_script'],
    kills: ['prop_registered_client_rejects_cross_type_script'],
  },
  {
    name: 'registered-client-datum-token', file: 'lib/ibc/utils/validator_utils.ak',
    before: '  expect view.token == token\n',
    after: '  expect view.token == token || True\n',
    tests: ['prop_registered_client_isolates_same_sequence_instances', 'prop_registered_client_rejects_cross_type_datum'],
    kills: ['prop_registered_client_rejects_cross_type_datum'],
  },
  {
    name: 'registered-client-proof-policy', file: 'lib/ibc/utils/validator_utils.ak',
    before: '  if registration.proof_policy == "" {',
    after: '  if registration.proof_policy == "" || True {',
    tests: ['registered_client_cannot_use_another_registered_types_verifier', 'prop_registered_client_rejects_another_types_proof_marker'],
    kills: ['prop_registered_client_rejects_another_types_proof_marker'],
  },
  {
    name: 'receive-replay', file: 'validators/spending_channel/recv_packet.ak',
    before: '      (!pairs.has_key(cur_packet_receipt, packet.sequence))?,',
    after: '      (!pairs.has_key(cur_packet_receipt, packet.sequence) || True)?,',
    tests: ['succeed_recv_packet', 'recv_packet_rejects_existing_receipt'],
    kills: ['recv_packet_rejects_existing_receipt'],
  },
  {
    name: 'native-send-amount', file: 'lib/ibc/implementation/spending_transfer_module.ak',
    before: '        valid_transfer_amount\n', after: '        valid_transfer_amount || True\n',
    tests: ['prop_funds_native_send_amount', 'prop_funds_native_send_short', 'prop_funds_native_send_excess'],
    kills: ['prop_funds_native_send_short', 'prop_funds_native_send_excess'],
  },
  {
    name: 'refund-amount', file: 'lib/ibc/apps/transfer/refund.ak',
    before: '      correct_receiver_amount?,', after: '      (correct_receiver_amount || True)?,',
    tests: ['prop_funds_asset_refund_amount', 'prop_funds_asset_refund_short', 'prop_funds_asset_refund_excess'],
    kills: ['prop_funds_asset_refund_short', 'prop_funds_asset_refund_excess'],
  },
  {
    name: 'send-commitment-binding', file: 'lib/ibc/implementation/spending_transfer_module.ak',
    before: '              commitment == packet_mod.commit_packet(packet),',
    after: '              commitment == packet_mod.commit_packet(packet) || True,',
    tests: ['regression_transfer_module_native_send_escrow_increases_exactly', 'transfer_send_rejects_mismatched_packet_commitment'],
    kills: ['transfer_send_rejects_mismatched_packet_commitment'],
  },
];

const report = { seed: 674, maxSuccess: 25, results: [] };
const dir = mkdtempSync(join(tmpdir(), 'aiken-mutations-'));
function run(tests, suffix) {
  const args = ['check', '--deny', '--seed', String(report.seed), '--max-success', String(report.maxSuccess), '--exact-match', ...tests.flatMap(t => ['-m', t])];
  const result = spawnSync('aiken', args, { cwd: dir, encoding: 'utf8', timeout: 300000, maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(`${output}.${suffix}.log`, result.stderr ?? '');
  writeFileSync(`${output}.${suffix}.json`, result.stdout ?? '');
  if (result.error || result.signal) throw new Error(`Mutation runner failed: ${result.error ?? result.signal}`);
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`No test report for ${suffix}; compilation failures do not kill mutants`); }
  const actual = parsed.modules.flatMap(m => m.tests);
  if (actual.length !== tests.length || tests.some(t => !actual.some(a => a.title === t))) throw new Error(`Incomplete test selection for ${suffix}`);
  return { status: result.status, tests: actual };
}
try {
  cpSync(root, dir, { recursive: true, filter: path => !['build', 'plutus.json'].includes(path.slice(root.length + 1).split('/')[0]) });
  mkdirSync(join(dir, 'build'), { recursive: true });
  symlinkSync(join(root, 'build/packages'), join(dir, 'build/packages'), 'dir');
  for (const mutation of mutations) {
    const file = join(dir, mutation.file);
    const original = readFileSync(file, 'utf8');
    if (original.split(mutation.before).length !== 2) throw new Error(`Mutation anchor changed: ${mutation.name}`);
    const baseline = run(mutation.tests, `${mutation.name}.baseline`);
    if (baseline.status !== 0 || baseline.tests.some(t => t.status !== 'pass')) throw new Error(`Baseline failed: ${mutation.name}`);
    writeFileSync(file, original.replace(mutation.before, mutation.after));
    try {
      const mutant = run(mutation.tests, `${mutation.name}.mutant`);
      const failed = mutant.tests.filter(t => t.status === 'fail').map(t => t.title);
      const killed = mutant.status !== 0 && mutation.kills.every(t => failed.includes(t));
      report.results.push({ name: mutation.name, file: mutation.file, sourceHash: createHash('sha256').update(original).digest('hex'), killed, failed });
      if (!killed) throw new Error(`Surviving mutant: ${mutation.name}`);
    } finally { writeFileSync(file, original); }
  }
} finally {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`Killed ${report.results.length} critical mutants after passing their baselines.`);
