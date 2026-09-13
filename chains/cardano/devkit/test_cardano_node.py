import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cardano_node import main, prepare_genesis


def native_files(folder, k=48):
    root = Path(folder)
    (root / "genesis").mkdir()
    (root / "genesis/byron-genesis.json").write_text(json.dumps({
        "protocolConsts": {"k": k, "protocolMagic": 42}, "startTime": 1767139200,
        "bootStakeholders": {"native-key": 1},
    }))
    (root / "genesis/shelley-genesis.json").write_text(json.dumps({"securityParam": 48}))
    configuration = root / "configuration.yaml"
    configuration.write_text("ByronGenesisFile: ./genesis/byron-genesis.json\n"
                             "ShelleyGenesisFile: ./genesis/shelley-genesis.json\n")
    return ["run", "--config", str(configuration), "--database-path", str(root / "db")]


class NodeTopologyTests(unittest.TestCase):
    def test_main_has_four_direct_connections_before_launch_and_after_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            topology = Path(folder) / "topology.json"
            topology.write_text(json.dumps({
                "localRoots": [{"accessPoints": [{"address": "127.0.0.1", "port": 3001}], "valency": 1}],
                "publicRoots": [{"accessPoints": [{"address": "127.0.0.1", "port": 3001}]}],
                "useLedgerAfterSlot": 5,
            }))
            args = [*native_files(folder), "--topology", str(topology)]
            with patch.dict(os.environ, {"DEVKIT_PEER": "false"}), patch("cardano_node.os.execv") as launch:
                main(args)
                first = topology.read_text()
                main(args)
                self.assertEqual(topology.read_text(), first)
            value = json.loads(first)
            self.assertEqual(value["localRoots"], [{
                "accessPoints": [{"address": f"producer-{i}.local", "port": 3001} for i in range(2, 6)],
                "valency": 4,
            }])
            self.assertEqual(value["publicRoots"], [])
            self.assertEqual(value["useLedgerAfterSlot"], 5)
            launch.assert_called_with("/usr/local/bin/cardano-node", ["/usr/local/bin/cardano-node", *args])

    def test_peer_launch_preserves_the_topology_created_by_native_join(self):
        with tempfile.TemporaryDirectory() as folder:
            topology = Path(folder) / "topology.json"
            native = '{"localRoots":[{"accessPoints":[{"address":"devkit.local","port":3001}],"valency":1}]}'
            topology.write_text(native)
            args = [*native_files(folder), "--topology", str(topology)]
            with patch.dict(os.environ, {"DEVKIT_PEER": "true"}), patch("cardano_node.os.execv"):
                main(args)
            self.assertEqual(topology.read_text(), native)

    def test_version_does_not_require_topology_and_malformed_run_does_not_launch(self):
        with patch.dict(os.environ, {"DEVKIT_PEER": "false"}), patch("cardano_node.os.execv") as launch:
            main(["--version"])
            launch.assert_called_once_with("/usr/local/bin/cardano-node", ["/usr/local/bin/cardano-node", "--version"])
            launch.reset_mock()
            with self.assertRaisesRegex(ValueError, "config file"):
                main(["run", "--topology"])
            launch.assert_not_called()


class GenesisTests(unittest.TestCase):
    def test_first_launch_corrects_only_byron_k_and_retained_restart_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder, k=10)
            byron = Path(folder) / "genesis/byron-genesis.json"
            original = json.loads(byron.read_text())
            prepare_genesis(args, peer=False)
            self.assertEqual(json.loads(byron.read_text()), {
                **original, "protocolConsts": {**original["protocolConsts"], "k": 48},
            })
            database = Path(folder) / "db"
            database.mkdir()
            (database / "immutable").mkdir()
            saved = byron.read_bytes()
            prepare_genesis(args, peer=False)
            self.assertEqual(byron.read_bytes(), saved)

    def test_mismatched_retained_database_is_never_rewritten_or_launched(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder, k=10)
            database = Path(folder) / "db"
            database.mkdir()
            (database / "immutable").mkdir()
            byron = Path(folder) / "genesis/byron-genesis.json"
            original = byron.read_bytes()
            with patch.dict(os.environ, {"DEVKIT_PEER": "false"}), patch("cardano_node.os.execv") as launch:
                with self.assertRaisesRegex(ValueError, "reset the DevKit network"):
                    main(args)
                launch.assert_not_called()
            self.assertEqual(byron.read_bytes(), original)

    def test_peer_requires_corrected_native_download_and_never_repairs_it(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder, k=10)
            byron = Path(folder) / "genesis/byron-genesis.json"
            original = byron.read_bytes()
            with self.assertRaisesRegex(ValueError, "Unexpected DevKit Byron"):
                prepare_genesis(args, peer=True)
            self.assertEqual(byron.read_bytes(), original)
            prepare_genesis(args, peer=False)
            prepare_genesis(args, peer=True)

    def test_unexpected_shelley_parameter_is_not_silently_repaired(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder, k=10)
            (Path(folder) / "genesis/shelley-genesis.json").write_text('{"securityParam": 10}')
            with self.assertRaisesRegex(ValueError, "Shelley securityParam 48"):
                prepare_genesis(args, peer=False)


if __name__ == "__main__":
    unittest.main()
