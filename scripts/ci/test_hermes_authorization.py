"""Check transfer of a Rust test executable and the Hermes workflow dependency gate."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hermes_authorization', Path(__file__).with_name('hermes-authorization.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class AuthorizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        source = cls.root / 'test.rs'
        source.write_text('''
mod policy {
    #[test]
    #[ignore]
    fn production_gateway_transactions_pass_independent_policy() {
        let path = std::env::var("IBC_CACHE_SIGNING_EVIDENCE").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "approved");
    }
    #[test]
    fn unrelated() { panic!("must not run unrelated tests"); }
}
''')
        manifest = cls.root / 'Cargo.toml'
        manifest.write_text('[package]\nname = "ibc-relayer"\nversion = "0.0.0"\nedition = "2021"\n[lib]\npath = "test.rs"\n')
        command = ['cargo', 'test', '--manifest-path', str(manifest), '--lib', '--no-run', '--message-format=json']
        build = subprocess.check_output(command, text=True)
        cls.record = next(record for record in map(json.loads, build.splitlines()) if record.get('executable'))
        cls.binary = Path(cls.record['executable']).resolve()
        # The packaging command must reuse the executable produced by the test build.
        modified = cls.binary.stat().st_mtime_ns
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
        if cls.binary.stat().st_mtime_ns != modified:
            raise AssertionError('Packaging unexpectedly rebuilt the Rust test executable')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.build = self.root / 'build.jsonl'
        self.build.write_text(json.dumps(self.record) + '\n')
        self.archive = self.root / 'authorization.tar.gz'
        self.evidence = self.root / 'gateway.json'
        self.evidence.write_text('approved')

    def test_selects_only_the_library_test_binary(self):
        other = copy.deepcopy(self.record)
        other['profile']['test'] = False
        dependency = copy.deepcopy(self.record)
        dependency['target']['name'] = 'dependency'
        self.build.write_text('\n'.join(map(json.dumps, [other, dependency, self.record, {'reason': 'build-finished', 'success': True}])))
        self.assertEqual(helper.select_binary(self.build), self.binary)

    def test_rejects_missing_or_ambiguous_binary(self):
        for records in [[], [self.record, self.record]]:
            self.build.write_text('\n'.join(map(json.dumps, records)))
            with self.assertRaises(ValueError):
                helper.select_binary(self.build)

    def test_runs_transferred_ignored_test_without_cargo(self):
        helper.pack(self.build, self.archive)
        # Run only the transferred executable, with no compiler or Cargo on PATH.
        revision = helper.revision()
        with patch.dict(os.environ, {'PATH': ''}), patch.object(helper, 'revision', return_value=revision):
            helper.authorize(self.archive, self.evidence)

    def test_propagates_authorization_failure(self):
        helper.pack(self.build, self.archive)
        self.evidence.write_text('rejected')
        with self.assertRaises(subprocess.CalledProcessError):
            helper.authorize(self.archive, self.evidence)

    def test_requires_evidence_and_the_expected_ignored_test(self):
        with self.assertRaises(ValueError):
            helper.authorize(self.archive, self.root / 'missing.json')
        for listing in ['', 'other: test\n', helper.TEST + '_extra: test\n',
                        f'a::{helper.TEST}: test\nb::{helper.TEST}: test\n']:
            with patch.object(helper.subprocess, 'check_output', return_value=listing), self.assertRaises(ValueError):
                helper.test_name(self.binary)

    def test_rejects_wrong_revision_corruption_and_wrong_test(self):
        helper.pack(self.build, self.archive)
        with patch.object(helper, 'revision', return_value='other-commit'), self.assertRaises(ValueError):
            helper.authorize(self.archive, self.evidence)
        with tarfile.open(self.archive, 'r:gz') as source:
            data = source.extractfile(helper.BINARY).read()
            original = json.load(source.extractfile('manifest.json'))
        for field, value in [('binarySha256', 'corrupt'), ('test', 'wrong-test')]:
            manifest = {**original, field: value}
            with tarfile.open(self.archive, 'w:gz') as output:
                for name, content in [(helper.BINARY, data), ('manifest.json', json.dumps(manifest).encode())]:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(content)
                    output.addfile(entry, io.BytesIO(content))
            with self.assertRaises(ValueError):
                helper.authorize(self.archive, self.evidence)

    def test_rejects_unexpected_archive_members(self):
        with tarfile.open(self.archive, 'w:gz') as output:
            output.addfile(tarfile.TarInfo('../unexpected'))
        with self.assertRaises(ValueError):
            helper.authorize(self.archive, self.evidence)

    def test_dependency_download_retries_are_bounded(self):
        workflow = (helper.ROOT / '.github/workflows/ci.yml').read_text()
        step = workflow.split('      - name: Download Hermes fixture dependencies\n')[1].split('      - name: Execute signed client operations')[0]
        script = step.split('        run: |\n')[1]
        script = '\n'.join(line.removeprefix('          ') for line in script.splitlines())
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        go = bin_dir / 'go'
        go.write_text('''#!/bin/bash
set -eu
[ "$1" = -C ] && [ "$3" = mod ] && [ "$4" = download ]
module="${2##*-}"
count_file="$COUNTERS/$module"
count=0
if [ -f "$count_file" ]; then read -r count < "$count_file"; fi
count=$((count + 1))
echo "$count" > "$count_file"
[ "$count" -gt "$FAILURES" ]
''')
        go.chmod(0o755)
        sleep = bin_dir / 'sleep'
        sleep.write_text('#!/bin/bash\nexit 0\n')
        sleep.chmod(0o755)
        for failures in [0, 1, 2, 3]:
            counters = self.root / f'counts-{failures}'
            counters.mkdir()
            result = subprocess.run(['/bin/bash', '-e', '-c', script],
                                    env={**os.environ, 'PATH': str(bin_dir), 'COUNTERS': str(counters), 'FAILURES': str(failures)},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1 if failures == 3 else 0, result.stderr)
            self.assertEqual(int((counters / 'core').read_text()), min(failures + 1, 3))
            for module in ['v8', 'v10']:
                if failures < 3:
                    self.assertEqual(int((counters / module).read_text()), failures + 1)
                else:
                    self.assertFalse((counters / module).exists())

    def test_workflow_overlaps_checks_and_preserves_final_gate(self):
        workflow = (helper.ROOT / '.github/workflows/ci.yml').read_text()
        checks, final = workflow.split('  hermes-checks:\n')[1].split('  hermes-relayer:\n')
        self.assertIn('needs: [docs-update, aiken-changes]\n', checks)
        self.assertNotIn('tendermint-cache-signing', checks)
        self.assertIn('name: Hermes Relayer\n', final)
        self.assertIn('if: ${{ always() &&', final)
        self.assertIn('needs: [docs-update, aiken-changes, hermes-checks, gateway]', final)
        self.assertNotIn('cargo ', final)
        for artifact in ['hermes-authorization-test', 'tendermint-cache-signing']:
            self.assertEqual(workflow.count(f'name: {artifact}\n'), 2)
        gate = final.split('        run: |\n')[1].split('\n      - ')[0]
        gate = '\n'.join(line.removeprefix('          ') for line in gate.splitlines())
        success = dict(DOCS_RESULT='success', DETECTOR_RESULT='success', HERMES_RESULT='success', GATEWAY_RESULT='success')
        subprocess.run(['bash', '-e', '-c', gate], env={**os.environ, **success}, check=True)
        for dependency in success:
            for result in ['failure', 'cancelled', 'skipped', '']:
                with self.subTest(dependency=dependency, result=result), self.assertRaises(subprocess.CalledProcessError):
                    subprocess.run(['bash', '-e', '-c', gate], env={**os.environ, **success, dependency: result}, check=True)
        detector = workflow.split('      - name: Detect Hermes changes')[1].split('      - name: Setup Node.js')[0]
        for path in ['scripts/ci/hermes-authorization.py', 'scripts/ci/test_hermes_authorization.py']:
            self.assertIn(path, detector)


if __name__ == '__main__':
    unittest.main()
