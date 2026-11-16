import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import yano_snapshot as snapshot


class SnapshotCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_fresh_and_restored_nodes_use_the_same_exact_genesis_time(self):
        genesis = self.root / "config/network/devnet/shelley-genesis.json"
        genesis.parent.mkdir(parents=True)
        genesis.write_text(json.dumps({"systemStart": "2024-01-01T00:00:00Z", "epochLength": 1200}))
        with patch.object(snapshot.time, "time", return_value=1794855351.573):
            fresh = snapshot.configure_genesis(self.root)
        self.assertEqual(fresh, 1794855351000)
        self.assertEqual(json.loads(genesis.read_text())["epochLength"], 18000)
        (self.root / "chainstate").mkdir()
        with patch.object(snapshot.time, "time", return_value=1794855999.999):
            self.assertEqual(snapshot.configure_genesis(self.root), fresh)

    def test_identity_changes_with_blueprint_runtime_and_deployment_inputs(self):
        files = ["cardano/onchain/plutus.json", "cardano/offchain/src/deployment.ts",
                 "scripts/ci/yano-deployment.ts", "scripts/ci/yano-shutdown.ts", "scripts/ci/yano_snapshot.py",
                 "distribution/yano", "distribution/config/genesis.json"]
        for name in files:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("original")

        def command(args, **kwargs):
            if args[0] == "git":
                return b"cardano/offchain/src/deployment.ts\0"
            return "deno pinned-version"

        with patch.object(snapshot.subprocess, "check_output", side_effect=command):
            key = snapshot.cache_identity(self.root / "distribution", self.root)[0]
            comment = self.root / "cardano/onchain/source.ak"
            comment.write_text("// An unchanged compiled blueprint should keep its cache")
            self.assertEqual(key, snapshot.cache_identity(self.root / "distribution", self.root)[0])
            for name in files:
                with self.subTest(name=name):
                    path = self.root / name
                    path.write_text("changed")
                    self.assertNotEqual(key, snapshot.cache_identity(self.root / "distribution", self.root)[0])
                    path.write_text("original")

    def test_corrupted_or_incomplete_fixture_is_rejected(self):
        fixture = self.root / "fixture"
        for name in ["checkpoint/CURRENT", "config/network/devnet/shelley-genesis.json",
                     "deployments/handler.json", "wallet.key", "inventory.json", "scripts.json", "provider-state.json"]:
            path = fixture / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("original")
        snapshot.seal_fixture(fixture, "key", {})
        snapshot.validate_fixture(fixture, "key")
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            snapshot.validate_fixture(fixture, "other-key")
        (fixture / "checkpoint/CURRENT").write_text("corrupted")
        with self.assertRaisesRegex(ValueError, "checksum"):
            snapshot.validate_fixture(fixture, "key")
        (fixture / "checkpoint/CURRENT").unlink()
        snapshot.seal_fixture(fixture, "key", {})
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            snapshot.validate_fixture(fixture, "key")

    def test_cache_hit_does_not_deploy(self):
        cache = self.root / "cache"
        cache.mkdir()
        with patch.object(snapshot, "cache_identity", return_value=("key", {})), \
                patch.object(snapshot, "verify_fixture", return_value={"passed": True}), \
                patch.object(snapshot, "build_fixture") as build:
            result = snapshot.run(self.root, cache, self.root / "output")
        self.assertEqual(result["cache"], "hit")
        self.assertFalse(result["saved"])
        build.assert_not_called()

    def test_integration_failure_does_not_rebuild_or_publish(self):
        cache = self.root / "cache"
        cache.mkdir()
        with patch.object(snapshot, "cache_identity", return_value=("key", {})), \
                patch.object(snapshot, "verify_fixture", side_effect=snapshot.IntegrationFailure("test failed")), \
                patch.object(snapshot, "build_fixture") as build:
            with self.assertRaises(snapshot.IntegrationFailure):
                snapshot.run(self.root, cache, self.root / "output")
        build.assert_not_called()
        self.assertFalse(json.loads((self.root / "output/result.json").read_text())["saved"])

    def test_invalid_cache_rebuilds_but_failed_candidate_is_not_published(self):
        cache = self.root / "cache"
        cache.mkdir()
        (cache / "marker").write_text("old")

        def build(distribution, work, fixture, key, identity):
            fixture.mkdir()
            (fixture / "marker").write_text("new")
            (work.parent / "fresh").mkdir(exist_ok=True)
            (work.parent / "fresh/integration-result.json").write_text('{"passed": true}')
            return 1.0

        with patch.object(snapshot, "cache_identity", return_value=("key", {})), \
                patch.object(snapshot, "build_fixture", side_effect=build), \
                patch.object(snapshot, "verify_fixture", side_effect=[ValueError("bad cache"), ValueError("bad candidate")]):
            with self.assertRaisesRegex(ValueError, "bad candidate"):
                snapshot.run(self.root, cache, self.root / "output")
        self.assertEqual((cache / "marker").read_text(), "old")
        result = json.loads((self.root / "output/result.json").read_text())
        self.assertEqual(result["cache"], "rebuild")
        self.assertFalse(result["saved"])

    def test_invalid_cache_is_replaced_after_successful_cold_restore(self):
        cache = self.root / "cache"
        cache.mkdir()

        def build(distribution, work, fixture, key, identity):
            fixture.mkdir()
            (fixture / "marker").write_text("verified")
            (work.parent / "fresh").mkdir(exist_ok=True)
            (work.parent / "fresh/integration-result.json").write_text('{"passed": true}')
            return 1.0

        with patch.object(snapshot, "cache_identity", return_value=("key", {})), \
                patch.object(snapshot, "build_fixture", side_effect=build), \
                patch.object(snapshot, "verify_fixture", side_effect=[ValueError("bad cache"), {"passed": True}]):
            result = snapshot.run(self.root, cache, self.root / "output")
        self.assertEqual((cache / "marker").read_text(), "verified")
        self.assertTrue(result["saved"])


if __name__ == "__main__":
    unittest.main()
