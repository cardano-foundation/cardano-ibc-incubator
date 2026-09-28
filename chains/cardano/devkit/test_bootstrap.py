import copy
import json
from pathlib import Path
import tempfile
import unittest

from bootstrap import prepare, seed
from cardano_node import seed_producers
from profile import normalized_genesis


def genesis():
    return {"byron": {"startTime": 1}, "shelley": {
        "systemStart": "start", "epochLength": 5000, "slotLength": 1,
        "initialFunds": {"initial-wallet": 300_000_000_000},
        "staking": {"pools": {"genesis-pool": {"cost": 170_000_000}}, "stake": {"initial-stake": "genesis-pool"}},
    }}


def pools(prefix=""):
    return [{"pool": f"{prefix}pool-{i}", "stake": f"{prefix}stake-{i}",
             "address": f"{prefix}address-{i}", "vrf": str(i) * 64} for i in range(2, 6)]


class BootstrapTests(unittest.TestCase):
    def test_seeding_preserves_devkit_settings_and_adds_funded_delegations(self):
        value = genesis()["shelley"]
        seed(value, pools())
        self.assertEqual((value["epochLength"], value["slotLength"]), (5000, 1))
        self.assertEqual(len(value["staking"]["pools"]), 5)
        for pool in pools():
            self.assertEqual(value["staking"]["stake"][pool["stake"]], pool["pool"])
            self.assertEqual(value["initialFunds"][pool["address"]], 300_000_000_000)
            self.assertEqual(value["staking"]["pools"][pool["pool"]]["vrf"], pool["vrf"])

    def test_duplicate_pool_keys_are_rejected(self):
        additional = pools()
        additional[1] = additional[0]
        value = genesis()["shelley"]
        original = copy.deepcopy(value)
        with self.assertRaisesRegex(ValueError, "distinct"):
            seed(value, additional)
        self.assertEqual(value, original)

    def test_restart_preserves_genesis_and_refuses_to_seed_a_retained_database(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "genesis").mkdir()
            path = root / "genesis/shelley-genesis.json"
            path.write_text(json.dumps(genesis()["shelley"]))
            manifest = root / "pools.json"
            manifest.write_text(json.dumps(pools()))
            args = ["--config", str(root / "configuration.json"), "--database-path", str(root / "db")]
            seed_producers(args, manifest)
            saved = path.read_bytes()
            (root / "db/immutable").mkdir(parents=True)
            seed_producers(args, manifest)
            self.assertEqual(path.read_bytes(), saved)
            (root / "genesis-seeded").unlink()
            with self.assertRaisesRegex(ValueError, "existing chain"):
                seed_producers(args, manifest)
            self.assertEqual(path.read_bytes(), saved)

    def test_incomplete_saved_keys_are_not_replaced_under_a_retained_genesis(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "pools.json").write_text(json.dumps(pools()))
            with self.assertRaisesRegex(ValueError, "keys are incomplete"):
                prepare(root)

    def test_reset_fingerprint_ignores_fresh_keys_but_preserves_timing_stake_and_pool_parameters(self):
        first, reset = genesis(), genesis()
        seed(first["shelley"], pools())
        seed(reset["shelley"], pools("new-"))
        self.assertEqual(normalized_genesis(first), normalized_genesis(reset))
        for field, value in (("epochLength", 600), ("slotLength", 0.1)):
            changed = copy.deepcopy(reset)
            changed["shelley"][field] = value
            self.assertNotEqual(normalized_genesis(first), normalized_genesis(changed))
        reset["shelley"]["initialFunds"]["new-address-2"] += 1
        self.assertNotEqual(normalized_genesis(first), normalized_genesis(reset))


if __name__ == "__main__":
    unittest.main()
