import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from profile import DEFAULTS, Runtime, block_production_ready, normalized_genesis, validate_settings, write_env


class ProfileTests(unittest.TestCase):
    def test_readiness_requires_a_connected_node_with_a_real_block(self):
        for health in ({"lastKnownTip": "origin"},
                       {"connectionStatus": "disconnected", "lastKnownTip": {"height": 7}}):
            with patch("profile.http", return_value=health):
                self.assertFalse(block_production_ready("http://localhost:1337"))

    def test_start_refuses_changed_configuration_without_touching_docker(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            (runtime.state / "profile.sha256").write_text("previous-configuration")
            with patch.object(runtime, "compose") as compose:
                with self.assertRaisesRegex(RuntimeError, "configuration changed"):
                    runtime.start()
                compose.assert_not_called()

    def test_rejects_colliding_ports_and_invalid_endpoints(self):
        for change in ({"DEVKIT_NODE_PORT": "10080"}, {"DEVKIT_NODE_PORT": "0"},
                       {"DEVKIT_NODE_PORT": "65536"}, {"DEVKIT_HOST": "localhost\nBAD=1"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_settings({**DEFAULTS, **change})

    def test_settings_are_retained_until_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.dict("os.environ", {"DEVKIT_NODE_PORT": "23001"}):
                first = Runtime(root)
                write_env(first.settings_path, first.settings)
            with patch.dict("os.environ", {"DEVKIT_NODE_PORT": "33001"}):
                self.assertEqual(Runtime(root).settings["DEVKIT_NODE_PORT"], "23001")

    def test_stop_is_scoped_to_checkout_and_preserves_volumes(self):
        with tempfile.TemporaryDirectory() as folder, patch("subprocess.run") as run:
            one = Runtime(Path(folder) / "one")
            two = Runtime(Path(folder) / "two")
            self.assertNotEqual(one.project, two.project)
            self.assertTrue(one.project.startswith("caribic-devkit-"))
            with patch.dict("os.environ", {"COMPOSE_PROJECT_NAME": "cardano", "COMPOSE_FILE": "wrong.yaml"}):
                one.stop()
            args, kwargs = run.call_args
            self.assertIn(one.project, args[0])
            self.assertNotIn("--volumes", args[0])
            self.assertNotIn("COMPOSE_FILE", kwargs["env"])
            self.assertNotIn("COMPOSE_PROJECT_NAME", kwargs["env"])
            self.assertEqual(args[0][-1], "stop")

    def test_reset_deletes_only_profile_artifacts_after_compose_succeeds(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            report = runtime.state / "test.json"
            note = runtime.state / "my-note.txt"
            report.write_text("{}")
            note.write_text("keep")
            with patch("subprocess.run") as run, patch.object(runtime, "compose", side_effect=RuntimeError("Docker unavailable")):
                run.return_value.stdout = ""
                with self.assertRaises(RuntimeError):
                    runtime.reset()
            self.assertTrue(report.exists())
            with patch("subprocess.run") as run, patch.object(runtime, "compose") as compose, patch.object(runtime, "start"):
                run.return_value.stdout = ""
                runtime.reset()
                compose.assert_called_once_with("down", "--volumes", "--remove-orphans")
            self.assertFalse(report.exists())
            self.assertEqual(note.read_text(), "keep")

    def test_dependent_network_identity_survives_restart_but_rotates_on_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            genesis = {"byron": {"startTime": 1767139200},
                       "shelley": {"systemStart": "2025-12-31T00:00:00Z", "networkMagic": 42}}
            def export_id():
                (runtime.state / "clock-offset").write_text("-123s")
                with patch("profile.http", side_effect=lambda url: genesis[url.rsplit("/", 1)[-1]]):
                    runtime.export_endpoints()
                values = dict(line.split("=", 1) for line in (runtime.state / "endpoints.env").read_text().splitlines())
                self.assertEqual(values["CARDANO_LOCAL_CLOCK_OFFSET"], "-123s")
                self.assertEqual(values["CARDANO_SYSTEM_START"], genesis["shelley"]["systemStart"])
                return values["CARDANO_LOCAL_NETWORK_ID"]
            first = export_id()
            self.assertEqual(export_id(), first)
            with patch("subprocess.run") as run, patch.object(runtime, "compose"), patch.object(runtime, "start"):
                run.return_value.stdout = ""
                runtime.reset()
            self.assertNotEqual(export_id(), first)

    def test_conway_delegation_is_confirmed_from_the_native_cli_response(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            response = [{"address": "stake_test1owner", "delegationDeposit": 2000000,
                         "rewardAccountBalance": 0, "stakeDelegation": "pool1registered",
                         "voteDelegation": None}]
            with patch.object(runtime, "cli", return_value=json.dumps(response)):
                self.assertTrue(runtime.pool_registered("pool1registered", "stake_test1owner"))
                self.assertFalse(runtime.pool_registered("pool1other", "stake_test1owner"))

    def test_genesis_fingerprint_ignores_only_start_time(self):
        genesis = {"byron": {"startTime": 1}, "shelley": {"systemStart": "one", "networkMagic": 42}}
        reset = json.loads(json.dumps(genesis))
        reset["byron"]["startTime"] = 2
        reset["shelley"]["systemStart"] = "two"
        self.assertEqual(normalized_genesis(genesis), normalized_genesis(reset))
        reset["shelley"]["networkMagic"] = 43
        self.assertNotEqual(normalized_genesis(genesis), normalized_genesis(reset))


if __name__ == "__main__":
    unittest.main()
