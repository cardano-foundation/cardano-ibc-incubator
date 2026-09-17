#!/usr/bin/env python3
"""Exercise identical full-validator fixtures with one guard removed per test copy.

Only temporary copies are mutated. The production tree/blueprint stay untouched.
The expected-failure annotation becomes expected-success in a mutant; transaction
inputs, outputs, redeemers and complete validator dispatch are identical.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'cardano/onchain'
CASES = [
    ('approval-quorum', 'validators/implementation_registry.ak',
     '        expect migration.authorized(old.governance, transaction)\n',
     'migration_adversarial_valid_approval', 'migration_adversarial_approval_rejects_missing_quorum'),
    ('escrow-conservation', 'lib/ibc/migration/auth.ak',
     '    validator_utils.preserves_state_value(input.output.value, output.value),\n',
     'migration_adversarial_valid_real_escrow_move_and_inventory_deletion', 'migration_adversarial_escrow_move_rejects_value_diversion'),
    ('core-completeness', 'validators/implementation_registry.ak',
     '        expect next == limits\n',
     'migration_adversarial_valid_activation', 'migration_adversarial_activation_rejects_omitted_core_state'),
    ('packet-claim-preservation', 'lib/ibc/migration/auth.ak',
     '    output.datum == input.output.datum,\n',
     'migration_packet_event_log_regression_462', 'migration_packet_handover_rejects_commitment_omission',
     'validators/migration_packet_model.test.ak'),
    ('moving-normal-operation-gate', 'lib/ibc/migration/auth.ak',
     '  expect phase == 0 || phase == 1\n',
     'containment_current_ready_permits_send', 'containment_current_moving_rejects_source_send',
     'validators/host_state_stt.test.ak'),
]

def digest():
    files = sorted([*SOURCE.glob('lib/**/*.ak'), *SOURCE.glob('validators/**/*.ak'), SOURCE/'aiken.toml', SOURCE/'aiken.lock'])
    return {str(p.relative_to(SOURCE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}

def replace_once(text, old, new):
    if text.count(old) != 1: raise RuntimeError(f'Fixture/source changed; expected one exact match: {old!r}')
    return text.replace(old, new)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    original = digest()
    reports = []
    with tempfile.TemporaryDirectory(prefix='cardano-ibc-migration-guards-') as temporary:
        for case in CASES:
            label, file, guard, positive, attack, *fixture_file = case
            for mutant in [False, True]:
                directory = Path(temporary) / f'{label}-{mutant}'
                shutil.copytree(SOURCE, directory, ignore=shutil.ignore_patterns('plutus.json', 'artifacts'))
                test = directory / (fixture_file[0] if fixture_file else 'validators/migration_adversarial.test.ak')
                fixtures = test.read_text()
                fixtures = replace_once(fixtures, f'test {positive}()', 'test mutation_control_valid()')
                fixtures = replace_once(fixtures, f'test {attack}() fail', 'test mutation_control_attack()' + ('' if mutant else ' fail'))
                test.write_text(fixtures)
                if mutant:
                    target = directory / file
                    target.write_text(replace_once(target.read_text(), guard, ''))
                command = ['aiken', 'check', '--seed', '462', '-m', 'mutation_control_', '--max-success', '1']
                run = subprocess.run(command, cwd=directory, text=True, capture_output=True)
                try: report = json.loads(run.stdout)
                except Exception as error: raise RuntimeError(f'{label}: invalid Aiken report\n{run.stderr}\n{run.stdout}') from error
                if run.returncode or report['summary']['total'] != 2 or report['summary']['passed'] != 2:
                    raise RuntimeError(f'{label} mutant={mutant}: expected both full-validator fixtures to satisfy their declared outcomes\n{run.stderr}\n{run.stdout}')
                reports.append({'case':label, 'mutant':mutant, 'guardFile':file, 'removedGuard':guard if mutant else None,
                                'attackAccepted':mutant, 'positiveControlAccepted':True, 'command':command, 'aiken':report})
                print(f'{label}: valid control accepted; attack {"accepted with guard removed" if mutant else "rejected by production"}',flush=True)
    if digest() != original: raise RuntimeError('Production source changed during the guard-control run')
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({'sourceSha256':original, 'scope':'Full Aiken validators, not a ledger-balanced populated migration rehearsal', 'results':reports},indent=2)+'\n')

if __name__ == '__main__': main()
