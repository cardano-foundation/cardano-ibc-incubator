#!/usr/bin/env python3
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


refs = load('deployment-references')
deployment = load('test-cardano-deployment')
runtime = load('migration-runtime')
clock = load('migration-clock-profile')


class References(unittest.TestCase):
    def test_fresh_genesis_must_precede_the_actual_registration_cutoff(self):
        # Exact failed CI genesis: more descendants cannot qualify these pools.
        for start in ['2026-09-14T18:20:59Z', '2026-01-01T00:00:00Z', '2025-12-31T23:59:59Z']:
            with self.subTest(start=start), self.assertRaisesRegex(ValueError, 'registration cutoff'):
                clock.require_qualified_genesis({'slotLength': 1, 'systemStart': start})
        for start in ['2025-12-29T00:00:00Z', '2025-12-31T23:59:58Z']:
            clock.require_qualified_genesis({'slotLength': 1, 'systemStart': start})
        with self.assertRaisesRegex(ValueError, 'UTC offset'):
            clock.require_qualified_genesis({'slotLength': 1, 'systemStart': '2025-12-29T00:00:00'})
        now = 1_789_667_200
        self.assertEqual(now + clock.initial_offset(now), 1_766_966_400)
        self.assertEqual(clock.initial_offset(now + 100), clock.initial_offset(now) - 100)

    def test_funding_requires_the_same_live_outref_amount_and_address(self):
        indexed = [{'transaction_id': 'aa', 'output_index': 0, 'address': 'wallet', 'value': {'coins': 100_000_000_000}}]
        ledger = {'aa#0': {'address': 'wallet', 'value': {'lovelace': 100_000_000_000}}}
        self.assertTrue(deployment.confirmed_wallet_funding('wallet', indexed, ledger))
        for incorrect in [{}, {'bb#0': ledger['aa#0']}, {'aa#0': {'address': 'other', 'value': {'lovelace': 100_000_000_000}}},
                          {'aa#0': {'address': 'wallet', 'value': {'lovelace': 99_999_999_999}}}]:
            self.assertFalse(deployment.confirmed_wallet_funding('wallet', indexed, incorrect))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            deployment.confirmed_wallet_funding('wallet', indexed * 2, ledger)

    def fixture(self):
        unit = {'txHash': 'ab' * 32, 'outputIndex': 0, 'address': 'holder', 'scriptRef': {'type': 'PlutusV3', 'script': '43420100'}}
        plan = {'referenceValidators': [{'script': {'type': 'PlutusV3', 'script': '420100'}, 'hash': 'cd' * 28}]}
        wanted = refs.manifest_references({'validators': {'test': {'scriptHash': 'cd' * 28, 'script': '420100', 'refUtxo': unit}}}, plan)
        indexed = [{'transaction_id': unit['txHash'], 'output_index': 0, 'address': 'holder', 'script_hash': 'cd' * 28, 'spent_at': None}]
        ledger = {unit['txHash'] + '#0': {'address': 'holder', 'referenceScript': {'script': {'type': 'PlutusScriptV3', 'cborHex': '420100'}}}}
        return wanted, indexed, ledger

    def test_swapped_canonical_references_cannot_satisfy_the_wrong_roles(self):
        scripts = [{'script': {'type': 'PlutusV3', 'script': '4201' + f'{i:02x}'}, 'hash': f'{i:02x}' * 28} for i in [1, 2]]
        validators = {f'role{i}': {'scriptHash': s['hash'], 'script': s['script']['script'], 'refUtxo': {
            'txHash': f'{i:02x}' * 32, 'outputIndex': 0, 'address': 'holder', 'scriptRef': s['script']}} for i, s in enumerate(scripts, 1)}
        plan = {'referenceValidators': scripts}
        refs.manifest_references({'validators': validators}, plan)
        a, b = validators.values()
        a['refUtxo'], b['refUtxo'] = b['refUtxo'], a['refUtxo']
        with self.assertRaisesRegex(ValueError, 'Validator role'):
            refs.manifest_references({'validators': validators}, plan)

    def test_same_script_inventory_cannot_satisfy_wrong_manifest_outref(self):
        wanted, indexed, ledger = self.fixture()
        refs.verify_references(wanted, indexed, ledger)
        indexed[0]['transaction_id'] = 'ee' * 32
        self.assertEqual({u['script_hash'] for u in indexed}, {u['scriptHash'] for u in wanted.values()})
        with self.assertRaisesRegex(ValueError, 'unique unspent'):
            refs.verify_references(wanted, indexed, ledger)

    def test_indexer_cannot_cover_a_ledger_rollback_or_wrong_script(self):
        for field in ['absent', 'bytes', 'address', 'language', 'duplicate', 'spent']:
            with self.subTest(field=field):
                wanted, indexed, ledger = self.fixture()
                refs.verify_references(wanted, indexed, ledger)
                actual = next(iter(ledger.values()))
                if field == 'absent': ledger.clear()
                if field == 'bytes': actual['referenceScript']['script']['cborHex'] = '420101'
                if field == 'address': actual['address'] = 'other'
                if field == 'language': actual['referenceScript']['script']['type'] = 'PlutusScriptV2'
                if field == 'duplicate': indexed.append(indexed[0])
                if field == 'spent': indexed[0]['spent_at'] = {'slot_no': 1}
                with self.assertRaises(ValueError): refs.verify_references(wanted, indexed, ledger)

    def test_startup_requires_preconfigured_witness_without_mutating_node(self):
        node = {'environment': {}, 'volumes': ['node-db:/data']}
        with self.assertRaisesRegex(ValueError, 'before deployment'):
            runtime.require_migration_witness(node)
        deployment.configure_migration_witness(node)
        original = copy.deepcopy(node)
        runtime.require_migration_witness(node)
        self.assertEqual(node, original)

    def test_clock_restarts_retain_offset_and_never_recompute_fixed_target(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            node = {'environment': {}}
            deployment.configure_relative_clock(node, directory, -259200)
            self.assertEqual((directory / 'migration-clock.rc').read_text(), '-259200s\n')
            self.assertEqual(node['environment']['CARDANO_LOCAL_CLOCK_FILE'], '/runtime/migration-clock.rc')
            # Execute the real clock setup, replacing only its final node launch
            # with env. A date stub ensures the fixed-target path cannot run.
            source = (Path(__file__).resolve().parents[2] / 'chains/cardano/local-clock-entrypoint').read_text()
            entry = directory / 'entry'
            entry.write_text(source.replace('exec /usr/local/bin/entrypoint "$@"', 'exec /usr/bin/env'))
            (directory / 'date').write_text('#!/bin/sh\nexit 99\n')
            (directory / 'date').chmod(0o755)
            env = {**os.environ, 'PATH': str(directory), 'CARDANO_LOCAL_CLOCK_FILE': str(directory / 'migration-clock.rc'), 'CARDANO_LOCAL_CLOCK_TARGET': '2000-01-01 00:00:00'}
            for _ in range(2):
                output = subprocess.check_output(['/bin/sh', str(entry)], env=env, text=True)
                self.assertIn('FAKETIME_TIMESTAMP_FILE=' + str(directory / 'migration-clock.rc'), output)
                self.assertIn('FAKETIME_NO_CACHE=1', output)
                self.assertNotIn('\nFAKETIME=', output)


if __name__ == '__main__': unittest.main()
