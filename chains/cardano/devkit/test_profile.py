import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from profile import DEFAULTS, PRODUCERS, Runtime, block_production_ready, normalized_genesis, validate_settings, write_env


class ProfileTests(unittest.TestCase):
    def test_funding_splits_confirmed_native_wallet_inputs_and_returns_its_change(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            recipient_queries = 0

            def cli(*args):
                nonlocal recipient_queries
                if args[:2] == ("query", "utxo"):
                    if args[3] == "utxo1-address":
                        return json.dumps({"tokens#0": {"value": {"lovelace": 500_000_000, "policy": {"asset": 1}}},
                                           "small#0": {"value": {"lovelace": 1_000_000}}})
                    if args[3] == "utxo2-address":
                        return json.dumps({"native#0": {"value": {"lovelace": 15_000_000}},
                                           "native#1": {"value": {"lovelace": 20_000_000}},
                                           "unused#0": {"value": {"lovelace": 1_000_000}}})
                    recipient_queries += 1
                    return json.dumps({("existing#0" if recipient_queries == 1 else "funding-tx#0"):
                                       {"value": {"lovelace": 10_000_000}}})
                if args[:2] == ("address", "build"):
                    return Path(args[3]).stem + "-address"
                if args[:3] == ("conway", "transaction", "txid"):
                    return "funding-tx"
                return ""

            with patch.object(runtime, "compose"), patch.object(runtime, "cli", side_effect=cli) as query, \
                    patch("profile.http") as faucet:
                runtime.fund("recipient-address", 40_000_000, outputs=4)
            calls = [call.args for call in query.call_args_list]
            build = next(call for call in calls if call[:3] == ("conway", "transaction", "build"))
            self.assertEqual([build[i + 1] for i, arg in enumerate(build) if arg == "--tx-in"],
                             ["native#1", "native#0"])
            self.assertEqual([build[i + 1] for i, arg in enumerate(build) if arg == "--tx-out"],
                             ["recipient-address+10000000"] * 3)
            self.assertEqual(build[build.index("--change-address") + 1], "utxo2-address")
            sign = next(call for call in calls if call[:3] == ("conway", "transaction", "sign"))
            self.assertEqual(sign[sign.index("--signing-key-file") + 1],
                             "/clusters/nodes/default/utxo-keys/utxo2.skey")
            self.assertFalse(any(call[:2] == ("address", "key-gen") for call in calls))
            self.assertEqual(sum(call[:3] == ("conway", "transaction", "submit") for call in calls), 1)
            faucet.assert_not_called()
            self.assertEqual(recipient_queries, 2)

    def test_funding_resubmits_the_same_body_after_startup_rollback(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            recipient_queries = 0

            def cli(*args):
                nonlocal recipient_queries
                if args[:2] == ("address", "build"):
                    return "source-address"
                if args[:2] == ("query", "utxo"):
                    if args[3] == "source-address":
                        return json.dumps({"source#0": {"value": {"lovelace": 100_000_000}}})
                    recipient_queries += 1
                    return json.dumps({"funding-tx#0": {"value": {"lovelace": 10_000_000}}}) if recipient_queries == 4 else "{}"
                if args[:3] == ("conway", "transaction", "txid"):
                    return "funding-tx"
                return ""

            with patch.object(runtime, "compose"), patch.object(runtime, "cli", side_effect=cli) as query, \
                    patch("profile.time.sleep"):
                runtime.fund("recipient-address", 10_000_000)
            calls = [call.args for call in query.call_args_list]
            submissions = [call for call in calls if call[:3] == ("conway", "transaction", "submit")]
            self.assertEqual(len(submissions), 3)
            self.assertTrue(all(call == submissions[0] for call in submissions))
            self.assertEqual(sum(call[:3] == ("conway", "transaction", "build") for call in calls), 1)
            self.assertEqual(sum(call[:3] == ("conway", "transaction", "sign") for call in calls), 1)

    def test_funding_does_not_submit_without_enough_confirmed_native_funds(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            def cli(*args):
                return "{}" if args[:2] == ("query", "utxo") else "native-address"
            with patch.object(runtime, "cli", side_effect=cli) as query, \
                    patch.object(runtime, "compose") as docker, patch("profile.http") as faucet:
                with self.assertRaisesRegex(RuntimeError, "insufficient confirmed ADA"):
                    runtime.fund("recipient-address", 10_000_000)
            self.assertFalse(any(call.args[:2] == ("conway", "transaction") for call in query.call_args_list))
            docker.assert_not_called()
            faucet.assert_not_called()

    def test_funding_preserves_an_already_funded_recipient(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            existing = {f"existing#{i}": {"value": {"lovelace": 10_000_000}} for i in range(4)}
            with patch.object(runtime, "cli", return_value=json.dumps(existing)) as query, \
                    patch.object(runtime, "compose") as docker:
                runtime.fund("recipient-address", 40_000_000, outputs=4)
            query.assert_called_once()
            docker.assert_not_called()

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
                       "shelley": {"systemStart": "2025-12-31T00:00:00Z", "networkMagic": 42, "epochLength": 5000}}
            def export_id():
                (runtime.state / "clock-offset").write_text("-123s")
                with patch("profile.http", side_effect=lambda url: genesis[url.rsplit("/", 1)[-1]]):
                    runtime.export_endpoints()
                values = dict(line.split("=", 1) for line in (runtime.state / "endpoints.env").read_text().splitlines())
                self.assertEqual(values["CARDANO_LOCAL_CLOCK_OFFSET"], "-123s")
                self.assertEqual(values["CARDANO_SYSTEM_START"], genesis["shelley"]["systemStart"])
                self.assertEqual(values["CARDANO_EPOCH_LENGTH"], "5000")
                return values["CARDANO_LOCAL_NETWORK_ID"]
            first = export_id()
            self.assertEqual(export_id(), first)
            with patch("subprocess.run") as run, patch.object(runtime, "compose"), patch.object(runtime, "start"):
                run.return_value.stdout = ""
                runtime.reset()
            self.assertNotEqual(export_id(), first)

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
