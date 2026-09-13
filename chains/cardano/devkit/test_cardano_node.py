import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cardano_node import main


class NodeTopologyTests(unittest.TestCase):
    def test_main_has_four_direct_connections_before_launch_and_after_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            topology = Path(folder) / "topology.json"
            topology.write_text(json.dumps({
                "localRoots": [{"accessPoints": [{"address": "127.0.0.1", "port": 3001}], "valency": 1}],
                "publicRoots": [{"accessPoints": [{"address": "127.0.0.1", "port": 3001}]}],
                "useLedgerAfterSlot": 5,
            }))
            args = ["run", "--topology", str(topology), "--config", "native.yaml", "--database-path", "db"]
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
            with patch.dict(os.environ, {"DEVKIT_PEER": "true"}), patch("cardano_node.os.execv"):
                main(["run", "--topology", str(topology)])
            self.assertEqual(topology.read_text(), native)

    def test_version_does_not_require_topology_and_malformed_run_does_not_launch(self):
        with patch.dict(os.environ, {"DEVKIT_PEER": "false"}), patch("cardano_node.os.execv") as launch:
            main(["--version"])
            launch.assert_called_once_with("/usr/local/bin/cardano-node", ["/usr/local/bin/cardano-node", "--version"])
            launch.reset_mock()
            with self.assertRaisesRegex(ValueError, "topology file"):
                main(["run", "--topology"])
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
