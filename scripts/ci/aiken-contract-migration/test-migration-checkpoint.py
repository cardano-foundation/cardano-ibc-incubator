#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('checkpoint', Path(__file__).with_name('restore-migration-checkpoint.py'))
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class Checkpoint(unittest.TestCase):
    def fixture(self, root):
        files = root / 'files'
        (files / 'runtime').mkdir(parents=True)
        (files / 'runtime/genesis-shelley.json').write_text('{"networkMagic":42}')
        (files / 'plutus.json').write_text('compiled deployment')
        (files / 'clock-state.json').write_text('{"offset":-5000000,"steps":[]}')
        (files / 'result.json').write_text(json.dumps({'artifacts': '/owned/source',
            'networkRuntime': '/owned/source', 'blueprintSha256': checkpoint.sha256(files / 'plutus.json')}))
        (files / 'compose.json').write_text('{"volumes":{"cluster-data":{}}}')
        archive = root / 'cluster-data.tar.gz'
        archive.write_bytes(b'actual saved bytes')
        metadata = {'format': 'pr905-real-pre-ibc-checkpoint-v1', 'sourceRuntime': '/owned/source',
            'project': 'cardano-deployment-test-source',
            'genesisSha256': checkpoint.sha256(files / 'runtime/genesis-shelley.json'),
            'clockState': json.loads((files / 'clock-state.json').read_text()),
            'volumes': [{'logical': 'cluster-data', 'file': archive.name, 'sha256': checkpoint.sha256(archive)}]}
        (root / 'checkpoint.json').write_text(json.dumps(metadata))
        return files / 'plutus.json'

    def test_corrupt_history_is_rejected_before_any_docker_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blueprint = self.fixture(root)
            checkpoint.inspect_checkpoint(root, blueprint)
            (root / 'cluster-data.tar.gz').write_bytes(b'changed history')
            with patch.object(checkpoint.subprocess, 'run') as run, patch.object(checkpoint.subprocess, 'check_output') as output:
                with self.assertRaisesRegex(ValueError, 'checksum'):
                    checkpoint.restore(root, checkpoint.ROOT / '.deployment-smoke/new-checkpoint-test',
                                       'cardano-deployment-test-fixture', blueprint)
                run.assert_not_called()
                output.assert_not_called()

    def test_other_contracts_genesis_and_unfinished_clocks_are_rejected(self):
        for changed in ['blueprint', 'genesis', 'clock', 'relayer', 'pending']:
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                blueprint = self.fixture(root)
                if changed == 'blueprint': blueprint.write_text('other deployment')
                elif changed == 'genesis': (root / 'files/runtime/genesis-shelley.json').write_text('other chain')
                elif changed == 'clock': (root / 'files/clock-state.json').write_text('{}')
                elif changed == 'relayer': (root / 'files/hermes.toml').write_text('initialized')
                else: (root / 'files/clock-pending.json').write_text('{}')
                with self.assertRaises(ValueError): checkpoint.inspect_checkpoint(root, blueprint)

    def test_existing_runtime_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blueprint = self.fixture(root)
            with patch.object(checkpoint, 'ROOT', root):
                runtime = root / '.deployment-smoke/existing'
                runtime.mkdir(parents=True)
                marker = runtime / 'keep'
                marker.write_text('existing state')
                with patch.object(checkpoint.subprocess, 'run') as run:
                    with self.assertRaisesRegex(ValueError, 'overwrite'):
                        checkpoint.restore(root, runtime, 'cardano-deployment-test-fixture', blueprint)
                    run.assert_not_called()
                self.assertEqual(marker.read_text(), 'existing state')

    def test_new_contracts_can_reuse_network_history_without_trusting_a_changed_saved_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved = self.fixture(root)
            fresh = root / 'fresh-blueprint.json'
            fresh.write_text('new reviewed contracts')
            with self.assertRaisesRegex(ValueError, 'selected blueprint'):
                checkpoint.inspect_checkpoint(root, fresh)
            checkpoint.inspect_checkpoint(root, None)
            saved.write_text('changed saved contracts')
            with self.assertRaisesRegex(ValueError, 'compiled deployment has changed'):
                checkpoint.inspect_checkpoint(root, None)

    def test_existing_volume_is_never_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blueprint = self.fixture(root)
            with patch.object(checkpoint, 'ROOT', root), patch.object(checkpoint.subprocess, 'run') as run, patch.object(
                    checkpoint.subprocess, 'check_output', side_effect=['', 'cardano-deployment-test-fixture_cluster-data\n']):
                with self.assertRaisesRegex(ValueError, 'Docker volume'):
                    checkpoint.restore(root, root / '.deployment-smoke/new', 'cardano-deployment-test-fixture', blueprint)
                run.assert_not_called()
                self.assertFalse((root / '.deployment-smoke/new').exists())


if __name__ == '__main__': unittest.main()
