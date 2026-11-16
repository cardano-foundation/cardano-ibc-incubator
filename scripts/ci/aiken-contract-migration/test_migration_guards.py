"""Regression checks for shard coverage and the migration guard report gate."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('migration_guards', Path(__file__).with_name('test-migration-guards.py'))
guards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guards)


def aiken_report():
    return {'summary': {'total': 2, 'passed': 2}, 'modules': [{'tests': [
        {'title': 'mutation_control_valid', 'status': 'pass'},
        {'title': 'mutation_control_attack', 'status': 'pass'},
    ]}]}


def shard_report(index, count):
    results = []
    for label, file, guard, positive, attack, *_ in guards.select_cases(index, count):
        for mutant in [False, True]:
            results.append({
                'case': label, 'mutant': mutant, 'guardFile': file,
                'removedGuard': guard if mutant else None,
                'executionScope': 'production Merkle function' if label == 'merkle-update-sibling-size' else 'full Aiken validator',
                'attackAccepted': mutant, 'positiveControlAccepted': True,
                'positiveFixture': positive, 'adversarialFixture': attack,
                'command': guards.COMMAND, 'aiken': aiken_report(), 'seconds': 1,
            })
    return {'sourceSha256': guards.digest(), 'runnerSha256': guards.runner_digest(),
            'compilerVersion': 'aiken v1.1.24', 'shardIndex': index,
            'shardCount': count, 'seconds': len(results), 'results': results}


class MigrationGuardTests(unittest.TestCase):
    def test_partitions_keep_every_pair_once(self):
        for count in range(1, len(guards.CASES) + 1):
            shards = [guards.select_cases(index, count) for index in range(count)]
            labels = [case[0] for shard in shards for case in shard]
            self.assertEqual(sorted(labels), sorted(case[0] for case in guards.CASES))
            self.assertTrue(all(shards))
        self.assertEqual([len(guards.select_cases(index, 5)) for index in range(5)], [3] * 5)

    def test_invalid_selection(self):
        for index, count in [(-1, 5), (5, 5), (0, 0), (0, 16)]:
            with self.subTest(index=index, count=count), self.assertRaises(ValueError):
                guards.select_cases(index, count)

    def merge(self, reports, count=5):
        with tempfile.TemporaryDirectory() as temporary:
            paths = []
            for index, report in enumerate(reports):
                path = Path(temporary) / f'{index}.json'
                path.write_text(json.dumps(report))
                paths.append(path)
            return guards.merge_reports(paths, count)

    def test_combines_all_pairs_and_preserves_fixture_mapping(self):
        reports = [shard_report(index, 5) for index in range(5)]
        combined = self.merge(list(reversed(reports)))
        self.assertEqual(len(combined['results']), 30)
        self.assertEqual(len(combined['shardSeconds']), 5)
        guards.validate_results(combined['results'], guards.CASES)
        for result in combined['results']:
            self.assertTrue(result['positiveFixture'])
            self.assertTrue(result['adversarialFixture'])

    def test_rejects_missing_duplicate_or_inconsistent_shards(self):
        reports = [shard_report(index, 5) for index in range(5)]
        with self.assertRaises(ValueError):
            self.merge(reports[:-1])
        with self.assertRaises(ValueError):
            self.merge(reports + [reports[0]])
        for field, value in [
            ('shardIndex', 1), ('shardIndex', True), ('shardIndex', 5),
            ('shardCount', 4), ('sourceSha256', {}), ('runnerSha256', 'stale'),
            ('compilerVersion', ''), ('compilerVersion', 'aiken v1.1.21'),
        ]:
            changed = copy.deepcopy(reports)
            changed[0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.merge(changed)

    def test_rejects_missing_duplicate_unknown_or_wrong_shard_cases(self):
        reports = [shard_report(index, 5) for index in range(5)]
        for replacement in [
            reports[0]['results'][:-1],
            reports[0]['results'] + [reports[0]['results'][0]],
            reports[1]['results'],
            [{**reports[0]['results'][0], 'case': 'unknown'}] + reports[0]['results'][1:],
        ]:
            changed = copy.deepcopy(reports)
            changed[0]['results'] = replacement
            with self.assertRaises(ValueError):
                self.merge(changed)

    def test_rejects_failed_tests_and_incorrect_evidence(self):
        report = shard_report(0, 5)
        for field, value in [
            ('mutant', 0), ('attackAccepted', True), ('positiveControlAccepted', False),
            ('guardFile', 'other.ak'), ('removedGuard', 'other guard'),
            ('positiveFixture', 'wrong_test'), ('adversarialFixture', 'wrong_test'),
            ('command', ['aiken', 'check']), ('executionScope', 'unknown'),
        ]:
            results = copy.deepcopy(report['results'])
            results[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                guards.validate_results(results, guards.select_cases(0, 5))
        for field, value in [('title', 'unrelated'), ('status', 'fail')]:
            results = copy.deepcopy(report['results'])
            results[0]['aiken']['modules'][0]['tests'][0][field] = value
            with self.assertRaises(ValueError):
                guards.validate_results(results, guards.select_cases(0, 5))
        results = copy.deepcopy(report['results'])
        results[0]['aiken']['summary']['passed'] = 1
        with self.assertRaises(ValueError):
            guards.validate_results(results, guards.select_cases(0, 5))

    def test_runner_keeps_pair_isolated_and_preserves_budget(self):
        case = ('sample', 'validators/guard.ak', 'expect guard', 'positive', 'attack')
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            (source / 'validators').mkdir()
            (source / 'aiken.toml').write_text('config')
            (source / 'aiken.lock').write_text('lock')
            (source / 'validators/guard.ak').write_text('expect guard')
            (source / 'validators/migration_adversarial.test.ak').write_text('test positive() {}\ntest attack() fail {}')
            directories = []

            def run(command, cwd, **kwargs):
                self.assertEqual(command, ['aiken', 'check', '--seed', '462', '-m', 'mutation_control_', '--max-success', '1'])
                mutant = bool(directories)
                directories.append(cwd)
                self.assertNotEqual(cwd, source)
                self.assertEqual((cwd / 'validators/guard.ak').read_text(), '' if mutant else 'expect guard')
                fixture = (cwd / 'validators/migration_adversarial.test.ak').read_text()
                self.assertIn('test mutation_control_valid()', fixture)
                self.assertEqual('test mutation_control_attack() fail' in fixture, not mutant)
                return subprocess.CompletedProcess(command, 0, json.dumps(aiken_report()), '')

            with patch.object(guards, 'SOURCE', source), patch.object(guards, 'CASES', [case]), \
                    patch.object(guards.subprocess, 'check_output', return_value='aiken v1.1.24'), \
                    patch.object(guards.subprocess, 'run', side_effect=run):
                original = guards.digest()
                result = guards.run_shard(0, 1)
                self.assertEqual(result['sourceSha256'], original)
                self.assertEqual(guards.digest(), original)
            self.assertEqual(len(set(directories)), 2)
            self.assertTrue(all(not directory.exists() for directory in directories))


if __name__ == '__main__':
    unittest.main()
