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
    (root / "genesis/shelley-genesis.json").write_text(json.dumps({"securityParam": 48, "protocolParams": {"protocolVersion": {"major": 11, "minor": 0}}}))
    models = json.loads((Path(__file__).resolve().parents[1] / "config/protocol-parameters.json").read_text())["costModels"]
    model = models["PlutusV3"]
    (root / "genesis/conway-genesis.json").write_text(json.dumps({"plutusV3CostModel": model[:251]}))
    (root / "genesis/alonzo-genesis.json").write_text(json.dumps({"extraConfig": {"costModels": models}}))
    (root / "genesis-seeded").touch()
    configuration = root / "configuration.yaml"
    configuration.write_text("ByronGenesisFile: ./genesis/byron-genesis.json\n"
                             "ShelleyGenesisFile: ./genesis/shelley-genesis.json\n"
                             "ConwayGenesisFile: ./genesis/conway-genesis.json\n"
                             "AlonzoGenesisFile: ./genesis/alonzo-genesis.json\n")
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

    def test_rehearsal_peers_can_keep_forging_without_the_primary(self):
        for producer in range(2, 6):
            with self.subTest(producer=producer), tempfile.TemporaryDirectory() as folder:
                topology = Path(folder) / "topology.json"
                topology.write_text('{"localRoots": [], "publicRoots": []}')
                args = [*native_files(folder), "--topology", str(topology)]
                with patch.dict(os.environ, {"DEVKIT_PEER": "true", "DEVKIT_FULL_MESH": "true",
                                             "DEVKIT_PRODUCER": f"producer-{producer}",
                                             "DEVKIT_CLOCK_FILE": "/runtime/migration-clock.rc",
                                             "FAKETIME_DONT_FAKE_MONOTONIC": "0"}), patch("cardano_node.os.execv"):
                    main(args)
                    self.assertEqual(os.environ["FAKETIME_DONT_FAKE_MONOTONIC"], "1")
                    main(args)
                roots = json.loads(topology.read_text())["localRoots"]
                addresses = {point["address"] for point in roots[0]["accessPoints"]}
                self.assertEqual(addresses, {"devkit.local", *{
                    f"producer-{i}.local" for i in range(2, 6) if i != producer}})
                self.assertEqual(roots[0]["valency"], 4)

    def test_version_does_not_require_topology_and_malformed_run_does_not_launch(self):
        with patch.dict(os.environ, {"DEVKIT_PEER": "false"}), patch("cardano_node.os.execv") as launch:
            main(["--version"])
            launch.assert_called_once_with("/usr/local/bin/cardano-node", ["/usr/local/bin/cardano-node", "--version"])
            launch.reset_mock()
            with self.assertRaisesRegex(ValueError, "config file"):
                main(["run", "--topology"])
            launch.assert_not_called()


class GenesisTests(unittest.TestCase):
    def test_protocol_11_prepares_hard_forks_and_tracing_in_json_and_yaml(self):
        for use_json in [True, False]:
            with self.subTest(use_json=use_json), tempfile.TemporaryDirectory() as folder:
                args = native_files(folder)
                configuration = Path(args[2])
                if use_json:
                    configuration.write_text(json.dumps({
                        "ByronGenesisFile": "./genesis/byron-genesis.json",
                        "ShelleyGenesisFile": "./genesis/shelley-genesis.json",
                        "ConwayGenesisFile": "./genesis/conway-genesis.json",
                        "AlonzoGenesisFile": "./genesis/alonzo-genesis.json",
                        "ExperimentalHardForksEnabled": True,
                        "TestEnableDevelopmentHardForkEras": True,
                    }))
                else:
                    configuration.write_text(configuration.read_text() +
                                             "ExperimentalHardForksEnabled: true\n"
                                             "TestEnableDevelopmentHardForkEras: true\n")
                prepare_genesis(args, peer=False)
                original = configuration.read_bytes()
                if use_json:
                    actual = json.loads(original)
                    self.assertFalse(actual["ExperimentalHardForksEnabled"])
                    self.assertNotIn("TestEnableDevelopmentHardForkEras", actual)
                    self.assertEqual(actual["TraceOptions"], {})
                else:
                    self.assertIn("ExperimentalHardForksEnabled: false", original.decode())
                    self.assertNotIn("TestEnableDevelopmentHardForkEras", original.decode())
                    self.assertIn("TraceOptions: {}", original.decode())
                prepare_genesis(args, peer=True)
                self.assertEqual(configuration.read_bytes(), original)

    def test_protocol_11_keeps_existing_tracing_options(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder)
            configuration = Path(args[2])
            tracing = 'TraceOptions:\n  "":\n    severity: Warning\n'
            configuration.write_text(configuration.read_text() + tracing)
            prepare_genesis(args, peer=False)
            self.assertIn(tracing, configuration.read_text())
            self.assertEqual(configuration.read_text().count("TraceOptions:"), 1)

    def test_protocol_11_cost_model_is_installed_only_before_the_first_block(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder)
            conway = Path(folder) / "genesis/conway-genesis.json"
            conway.write_text(json.dumps({"plutusV3CostModel": [1] * 297}))
            prepare_genesis(args, peer=False)
            model = json.loads(conway.read_text())["plutusV3CostModel"]
            self.assertEqual(len(model), 251)
            alonzo = Path(folder) / "genesis/alonzo-genesis.json"
            overrides = json.loads(alonzo.read_text())["extraConfig"]["costModels"]
            self.assertEqual(len(overrides["PlutusV3"]), 350)
            (Path(folder) / "db").mkdir()
            (Path(folder) / "db/block").touch()
            original = conway.read_bytes()
            prepare_genesis(args, peer=False)
            self.assertEqual(conway.read_bytes(), original)
            conway.write_text(json.dumps({"plutusV3CostModel": [1] * 297}))
            original = conway.read_bytes()
            with self.assertRaisesRegex(ValueError, "Retained DevKit cost model"):
                prepare_genesis(args, peer=False)
            self.assertEqual(conway.read_bytes(), original)
            conway.write_text(json.dumps({"plutusV3CostModel": model}))
            value = json.loads(alonzo.read_text())
            value["extraConfig"]["costModels"]["PlutusV3"] = [1] * 350
            alonzo.write_text(json.dumps(value))
            original = alonzo.read_bytes()
            with self.assertRaisesRegex(ValueError, "Retained DevKit cost model"):
                prepare_genesis(args, peer=False)
            self.assertEqual(alonzo.read_bytes(), original)

    def test_old_ledger_protocol_is_rejected_without_changing_genesis(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder)
            shelley = Path(folder) / "genesis/shelley-genesis.json"
            value = json.loads(shelley.read_text())
            value["protocolParams"]["protocolVersion"]["major"] = 10
            shelley.write_text(json.dumps(value))
            original = shelley.read_bytes()
            with self.assertRaisesRegex(ValueError, "requires protocol version 11"):
                prepare_genesis(args, peer=False)
            self.assertEqual(shelley.read_bytes(), original)

    def test_native_json_configuration_resolves_genesis_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            args = native_files(folder, k=10)
            Path(args[2]).write_text(json.dumps({
                "ByronGenesisFile": "./genesis/byron-genesis.json",
                "ShelleyGenesisFile": "./genesis/shelley-genesis.json",
                "ConwayGenesisFile": "./genesis/conway-genesis.json",
                "AlonzoGenesisFile": "./genesis/alonzo-genesis.json",
            }))
            prepare_genesis(args, peer=False)
            byron = json.loads((Path(folder) / "genesis/byron-genesis.json").read_text())
            self.assertEqual(byron["protocolConsts"]["k"], 48)
            prepare_genesis(args, peer=True)

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

    def test_fresh_pool_aging_profile_pins_both_eras_to_2160(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"DEVKIT_SECURITY_PARAM": "2160"}):
            args = native_files(folder, k=10)
            (Path(folder) / "genesis/shelley-genesis.json").write_text(json.dumps({"securityParam": 2160, "protocolParams": {"protocolVersion": {"major": 11, "minor": 0}}}))
            prepare_genesis(args, peer=False)
            byron = json.loads((Path(folder) / "genesis/byron-genesis.json").read_text())
            self.assertEqual(byron["protocolConsts"]["k"], 2160)
            prepare_genesis(args, peer=True)

    def test_pool_aging_cannot_change_a_retained_genesis(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"DEVKIT_SECURITY_PARAM": "2160"}):
            args = native_files(folder)
            with self.assertRaisesRegex(ValueError, "Shelley securityParam 2160"):
                prepare_genesis(args, peer=False)

    def test_unsupported_fixture_security_parameter_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"DEVKIT_SECURITY_PARAM": "49"}):
            with self.assertRaisesRegex(ValueError, "Unsupported DevKit security"):
                prepare_genesis(native_files(folder), peer=False)


if __name__ == "__main__":
    unittest.main()
