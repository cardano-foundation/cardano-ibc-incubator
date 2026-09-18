#!/usr/bin/env python3
"""Exercise identical production fixtures with one guard removed per test copy.

Only temporary copies are mutated. The production tree/blueprint stay untouched.
The expected-failure annotation becomes expected-success in a mutant; transaction
inputs, outputs, redeemers and complete validator dispatch are identical for
validator cases. The Merkle-size case executes the production tree function;
each result explicitly distinguishes its execution scope.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'cardano/onchain'
CASES = [
    ('merkle-update-sibling-size', 'lib/ibc/core/ics-025-handler-interface/ibc_state_commitment.ak',
     '    [sibling, ..rest] -> {\n      expect bytearray.length(sibling) == hash_size_bytes\n',
     'migration_budget_update_accepts_exact_witness', 'migration_budget_update_rejects_wrong_sibling_size',
     'lib/ibc/migration/budget_equivalence.test.ak',
     '    [sibling, ..rest] -> {\n'),
    ('emergency-key-replacement-generation', 'validators/implementation_registry.ak',
     'approval.registry_nonce == old.nonce && approval.generation == old.current.generation',
     'emergency_authority_removal_survives_restrictions_ready', 'emergency_authority_only_rotation_rejects_stale_generation',
     'validators/migration_adversarial.test.ak',
     'approval.registry_nonce == old.nonce'),
    ('emergency-key-replacement-quorum', 'validators/implementation_registry.ak',
     '      ProposeEmergencyRotation { authority, expires_at } -> {\n        expect control_only(transaction)\n        expect migration.authorized(old.governance, transaction)\n',
     'emergency_authority_removal_survives_restrictions_ready', 'emergency_authority_only_rotation_requires_governance',
     'validators/migration_adversarial.test.ak',
     '      ProposeEmergencyRotation { authority, expires_at } -> {\n        expect control_only(transaction)\n'),
    ('approval-quorum', 'validators/implementation_registry.ak',
     '      Propose { proposal, expires_at } -> {\n        expect control_only(transaction)\n        expect old.phase == Ready\n        expect migration.authorized(old.governance, transaction)\n',
     'migration_adversarial_valid_approval', 'migration_adversarial_approval_rejects_missing_quorum',
     'validators/migration_adversarial.test.ak',
     '      Propose { proposal, expires_at } -> {\n        expect control_only(transaction)\n        expect old.phase == Ready\n'),
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
    ('emergency-authority', 'validators/implementation_registry.ak',
     '        expect\n          migration.emergency_authorized(old.emergency.authority, transaction)\n',
     'emergency_immediate_before_proposal', 'emergency_rejects_code_authority_without_emergency_key'),
    ('emergency-activation-hold', 'validators/implementation_registry.ak',
     '    expect\n      when redeemer is {\n        Begin |\n        MoveCore { .. } |\n        MoveTransferRoot |\n        MoveEscrow { .. } |\n        Activate { .. } -> migration.permitted(old.emergency.mask, 8)\n        _ -> True\n      }\n',
     'emergency_traffic_restriction_survives_activation', 'emergency_hold_rejects_previously_approved_activation'),
    ('emergency-packet-gate', 'validators/upgradeable/host_state.ak',
     '      expect\n        when redeemer is {\n          Heartbeat -> migration.permitted(registry.restrictions, 4)\n          UpdateClient { .. } -> migration.permitted(registry.restrictions, 2)\n          CreateClient { .. } ->\n            migration.permitted(registry.restrictions, 1) && migration.permitted(\n              registry.restrictions,\n              2,\n            )\n          _ -> migration.permitted(registry.restrictions, 1)\n        }\n',
     'emergency_traffic_mask_phase_0_client', 'emergency_traffic_mask_phase_0_send',
     'validators/host_state_stt.test.ak'),

    ('emergency-outgoing-authority', 'validators/implementation_registry.ak',
     '          governance,\n          phase: Ready,\n          emergency: Emergency { ..old.emergency, restoration: None },\n',
     'migration_adversarial_valid_permissionless_rotation_execution',
     'emergency_rotation_rejects_retaining_outgoing_restoration',
     'validators/migration_adversarial.test.ak',
     '          governance,\n          phase: Ready,\n'),

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
                    target.write_text(replace_once(target.read_text(), guard, fixture_file[1] if len(fixture_file) > 1 else ''))
                command = ['aiken', 'check', '--seed', '462', '-m', 'mutation_control_', '--max-success', '1']
                run = subprocess.run(command, cwd=directory, text=True, capture_output=True)
                try: report = json.loads(run.stdout)
                except Exception as error: raise RuntimeError(f'{label}: invalid Aiken report\n{run.stderr}\n{run.stdout}') from error
                if run.returncode or report['summary']['total'] != 2 or report['summary']['passed'] != 2:
                    raise RuntimeError(f'{label} mutant={mutant}: expected both fixtures to satisfy their declared outcomes\n{run.stderr}\n{run.stdout}')
                reports.append({'case':label, 'mutant':mutant, 'guardFile':file, 'removedGuard':guard if mutant else None,
                                'executionScope':'production Merkle function' if label == 'merkle-update-sibling-size' else 'full Aiken validator',
                                'attackAccepted':mutant, 'positiveControlAccepted':True, 'command':command, 'aiken':report})
                print(f'{label}: valid control accepted; attack {"accepted with guard removed" if mutant else "rejected by production"}',flush=True)
    if digest() != original: raise RuntimeError('Production source changed during the guard-control run')
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({'sourceSha256':original, 'scope':'Production Aiken execution; per-case scope distinguishes full validators from the Merkle function. Not a ledger-balanced populated migration rehearsal.', 'results':reports},indent=2)+'\n')

if __name__ == '__main__': main()
