#!/usr/bin/env python3
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


def load(name, directory=None):
    spec = importlib.util.spec_from_file_location(name, (directory or Path(__file__).parent) / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


refs = load('deployment-references')
deployment = load('test-cardano-migration-deployment', Path(__file__).resolve().parent.parent)
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

    def test_yaci_rehearsal_config_preserves_native_services_and_reuses_saved_state(self):
        devkit = deployment._devkit
        config = {'services': {name: {'environment': {}, 'volumes': []} for name in devkit.NODES},
                  'volumes': {'cluster-data': {}, 'history-data': {}}}
        config['services']['history'] = {'volumes': []}
        port = 31000
        class Reservation:
            def bind(self, address):
                nonlocal port
                port += 1
                self.port = address[1] or port
            def getsockname(self): return ('127.0.0.1', self.port)
            def close(self): pass
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(devkit.socket, 'socket', Reservation), patch.object(
                    devkit.profile.Runtime, 'compose', return_value=json.dumps(config)):
                instance = devkit.MigrationRuntime(root, 'cardano-deployment-test-fixture',
                    -259200, 432000, 2637, 2742)
            saved = json.loads(instance.compose_file.read_text())
            self.assertEqual(set(saved['services']), {*devkit.NODES, 'history'})
            for name in devkit.NODES:
                service = saved['services'][name]
                self.assertEqual(service['environment']['DEVKIT_EPOCH_LENGTH'], '432000')
                self.assertEqual(service['environment']['DEVKIT_CLOCK_FILE'], '/runtime/migration-clock.rc')
                self.assertEqual(service['environment']['DEVKIT_FULL_MESH'], 'true')
            self.assertIn('store.epoch-nonce.enabled=true', (root / 'yaci.properties').read_text())
            before = instance.compose_file.read_bytes()
            with patch.object(devkit.profile.Runtime, 'compose') as compose:
                devkit.MigrationRuntime(root, instance.project, -1, 5000, 2337, 2442, existing=True)
                compose.assert_not_called()
            self.assertEqual(instance.compose_file.read_bytes(), before)
            self.assertEqual((root / 'runtime/migration-clock.rc').read_text(), '-259200s\n')

    def test_counterparty_clock_patch_targets_the_final_build_step(self):
        builder = load('build-migration-cosmos')
        captured = []
        def build(command, **kwargs):
            dockerfile = Path(command[command.index('-f') + 1]).read_text()
            captured.append(dockerfile)
        with patch.object(sys, 'argv', ['build-migration-cosmos.py']), patch.object(builder.subprocess, 'run', build):
            builder.main()
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].count("COPY <<'MIGRATION_CLOCK_SOURCE'"), 1)
        self.assertLess(captured[0].index('case "${LOCAL_FIXTURE_CLOCK}"'),
                        captured[0].index('COPY <<'))
        self.assertIn('--mount=type=tmpfs,target=/tmp', captured[0])

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
        node['ports'] = [{'host_ip': '127.0.0.1', 'published': '23001', 'target': 3001}]
        original = copy.deepcopy(node)
        runtime.require_migration_witness(node)
        self.assertEqual(node, original)

    def test_clock_restarts_retain_offset_and_never_recompute_fixed_target(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            node = {'environment': {}}
            deployment.configure_relative_clock(node, directory, -259200)
            self.assertEqual((directory / 'migration-clock.rc').read_text(), '-259200s\n')
            self.assertEqual(node['environment']['DEVKIT_CLOCK_FILE'], '/runtime/migration-clock.rc')
            source = (Path(__file__).resolve().parents[3] / 'chains/cardano/devkit/entrypoint.sh').read_text()
            # Run the clock setup itself without launching the external CLI.
            entry = directory / 'entry'
            entry.write_text(source[:source.index('if [ -f /clusters')] + '\nexec /usr/bin/env\n')
            env = {**os.environ, 'DEVKIT_CLOCK_FILE': str(directory / 'migration-clock.rc'),
                   'DEVKIT_CLOCK_OFFSET': '+123s', 'FAKETIME': '+999s'}
            for _ in range(2):
                output = subprocess.check_output(['/bin/sh', str(entry)], env=env, text=True)
                self.assertIn('FAKETIME_TIMESTAMP_FILE=' + str(directory / 'migration-clock.rc'), output)
                self.assertIn('FAKETIME_NO_CACHE=1', output)
                self.assertNotIn('\nFAKETIME=', output)
            deployment.configure_relative_clock(node, directory, -1)
            self.assertEqual((directory / 'migration-clock.rc').read_text(), '-259200s\n')



if __name__ == '__main__': unittest.main()
