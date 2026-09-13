import json
import shlex
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from profile import DEFAULTS, PRODUCERS, Runtime, block_production_ready, normalized_genesis, validate_settings, write_env


class ProfileTests(unittest.TestCase):
    def test_saved_peers_resume_before_readiness_without_starting_unfinished_registrations(self):
        original_run = subprocess.run
        for retained in (PRODUCERS, ("producer-2", "producer-4"), ()):
            with self.subTest(retained=retained), tempfile.TemporaryDirectory() as folder:
                runtime = Runtime(Path(folder))
                volumes = {}
                for service in PRODUCERS:
                    volume = Path(folder) / service
                    volumes[f"{runtime.project}_{service}-data"] = volume
                    for name in ("nodes/default/cluster-info.json", "pool-keys/default/opcert.cert"):
                        path = volume / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text("native state")
                    if service in retained:
                        (volume / "registered").touch()

                def run(args, **kwargs):
                    if args[:3] == ["docker", "volume", "ls"]:
                        self.assertIn(f"label=com.docker.compose.project={runtime.project}", args)
                        return subprocess.CompletedProcess(args, 0, "\n".join(volumes), "")
                    self.assertEqual(args[:3], ["docker", "run", "--rm"])
                    self.assertEqual(args[args.index("--network") + 1], "none")
                    self.assertIn("--read-only", args)
                    mount = args[args.index("--mount") + 1]
                    self.assertTrue(mount.endswith(",dst=/retained,readonly"))
                    volume_name = mount.split("src=", 1)[1].split(",", 1)[0]
                    script = args[-1].replace("/retained", shlex.quote(str(volumes[volume_name])))
                    return original_run(["sh", "-c", script], capture_output=True)

                class ReadinessReached(Exception):
                    pass

                def readiness(label, _probe, **kwargs):
                    self.assertEqual(label, "DevKit genesis")
                    starts = [call.args for call in docker.call_args_list if call.args[0] == "up"]
                    expected = [("up", "-d", "--build", "devkit")]
                    if retained:
                        expected.append(("up", "-d", "--build", *retained))
                    self.assertEqual(starts, expected)
                    raise ReadinessReached()

                with patch("profile.subprocess.run", side_effect=run), \
                        patch.object(runtime, "compose", return_value="sha256:owned-node-image") as docker, \
                        patch("profile.wait_for", side_effect=readiness):
                    with self.assertRaises(ReadinessReached):
                        runtime.start()

    def test_fresh_start_does_not_create_or_launch_peer_inspection_containers(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            with patch("profile.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run, \
                    patch.object(runtime, "compose") as docker:
                runtime.resume_provisioned_producers()
            self.assertEqual(run.call_count, 1)
            docker.assert_not_called()

    def test_failed_retained_state_inspection_does_not_assume_a_fresh_peer(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            volume = f"{runtime.project}_producer-2-data"
            responses = [subprocess.CompletedProcess([], 0, volume + "\n", ""),
                         subprocess.CompletedProcess([], 125, b"", b"daemon unavailable")]
            with patch("profile.subprocess.run", side_effect=responses), \
                    patch.object(runtime, "compose", return_value="owned-image") as docker:
                with self.assertRaisesRegex(RuntimeError, "Cannot inspect retained producer-2.*daemon unavailable"):
                    runtime.resume_provisioned_producers()
            self.assertEqual([call.args for call in docker.call_args_list], [("images", "-q", "devkit")])

    def test_late_unfinished_registration_is_refused_before_starting_the_peer(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            (runtime.state / "clock-offset").write_text("-100s")
            cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
            with patch("profile.time.time", return_value=cutoff + 100), \
                    patch.object(runtime, "compose", return_value="") as docker:
                with self.assertRaisesRegex(RuntimeError, "registration cutoff.*reset"):
                    runtime.start_producers()
            self.assertEqual([call.args[0] for call in docker.call_args_list], ["ps"])

    def test_completed_registration_can_restart_after_cutoff_but_partial_registration_cannot(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            (runtime.state / "clock-offset").write_text("+0s")
            cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
            with patch("profile.time.time", return_value=cutoff + 60), \
                    patch.object(runtime, "compose", return_value="stopped-peer"), \
                    patch("profile.subprocess.run") as copy:
                copy.return_value.returncode = 0
                runtime.assert_pool_registration_window("producer-2")
                copy.return_value.returncode = 1
                with self.assertRaisesRegex(RuntimeError, "registration is unfinished"):
                    runtime.assert_pool_registration_window("producer-3")
            self.assertEqual(copy.call_args.args[0], ["docker", "cp", "stopped-peer:/clusters/registered", "-"])

    def test_backdated_registration_before_cutoff_does_not_require_a_completed_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))
            (runtime.state / "clock-offset").write_text("-100s")
            cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
            with patch("profile.time.time", return_value=cutoff), patch.object(runtime, "compose") as docker:
                runtime.assert_pool_registration_window("producer-2")
            docker.assert_not_called()

    def test_failed_native_registration_restarts_only_its_peer_once(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))

            def compose(*args, **kwargs):
                if args[0] == "ps":
                    return "producer-container"
                if args[0] == "logs":
                    return "com.bloxbean.cardano.client.api.exception.ApiRuntimeException: Error fetching protocol params"

            def probe_wait(_label, probe, timeout):
                self.assertFalse(probe())
                self.assertFalse(probe())
                self.assertTrue(probe())

            with patch.object(runtime, "compose", side_effect=compose) as docker, \
                    patch.object(runtime, "pool_registered", side_effect=[False, False, True]), \
                    patch("profile.subprocess.run") as inspect, patch("profile.wait_for", side_effect=probe_wait):
                inspect.return_value.stdout = "2026-09-13T17:00:00Z\n"
                runtime.wait_for_pool_registration("producer-4", "pool-id", "stake-address")
            self.assertEqual([call.args for call in docker.call_args_list if call.args[0] == "restart"],
                             [("restart", "producer-4")])
            self.assertIn(("logs", "--no-color", "--since", "2026-09-13T17:00:00Z", "producer-4"),
                          [call.args for call in docker.call_args_list])

    def test_slow_native_registration_and_completed_registration_are_not_restarted(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Runtime(Path(folder))

            def probe_wait(_label, probe, timeout):
                self.assertFalse(probe())
                self.assertTrue(probe())

            with patch.object(runtime, "compose", return_value="Waiting for transaction inclusion") as docker, \
                    patch.object(runtime, "pool_registered", side_effect=[False, True]), \
                    patch("profile.subprocess.run") as inspect, patch("profile.wait_for", side_effect=probe_wait):
                inspect.return_value.stdout = "2026-09-13T17:00:00Z\n"
                runtime.wait_for_pool_registration("producer-4", "pool-id", "stake-address")
            self.assertFalse(any(call.args[0] == "restart" for call in docker.call_args_list))

    def test_native_topup_server_error_restarts_only_the_failed_peer_once(self):
        for error in ("InternalServerError", "BadGateway"):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as folder:
                runtime = Runtime(Path(folder))
                def compose(*args, **kwargs):
                    if args[0] == "ps":
                        return "producer-container"
                    if args[0] == "logs":
                        return f"org.springframework.web.client.HttpServerErrorException${error}: topup failed"
                def probe_wait(_label, probe, timeout):
                    self.assertFalse(probe())
                    self.assertFalse(probe())
                    self.assertTrue(probe())
                with patch.object(runtime, "compose", side_effect=compose) as docker, \
                        patch.object(runtime, "pool_registered", side_effect=[False, False, True]), \
                        patch("profile.subprocess.run") as inspect, patch("profile.wait_for", side_effect=probe_wait):
                    inspect.return_value.stdout = "2026-09-13T17:00:00Z\n"
                    runtime.wait_for_pool_registration("producer-3", "pool-id", "stake-address")
                self.assertEqual([call.args for call in docker.call_args_list if call.args[0] == "restart"],
                                 [("restart", "producer-3")])

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
