"""The local Cosmos fixture must never reuse state under another network clock."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("local_clock.sh")


class LocalClockTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.genesis = self.home / "config/genesis.json"
        self.genesis.parent.mkdir()
        self.marker = self.home / ".caribic-local-clock.json"
        past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
        self.env = {
            **os.environ, "SIMD_HOME": str(self.home), "GENESIS_FILE": str(self.genesis),
            "PROFILE": "v8-classic", "CHAIN_ID": "v8-classic-1",
            "GENESIS_TIME": past.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "COSMOS_LOCAL_CLOCK_MODE": "devkit", "DEVKIT_CLOCK_OFFSET": "-3600s",
            "COSMOS_LOCAL_CARDANO_NETWORK_ID": "first-network-instance",
        }

    def check_clock(self, capability="1", record=False):
        command = '. "$1"; check_local_clock "$2"'
        if record:
            command += '; record_local_clock'
        return subprocess.run(["sh", "-ec", command, "clock-test", str(SCRIPT), capability],
                              env=self.env, text=True, capture_output=True)

    def write_genesis(self):
        self.genesis.write_text(json.dumps({"chain_id": self.env["CHAIN_ID"],
                                          "genesis_time": self.env["GENESIS_TIME"]}))

    def test_restart_accepts_only_the_same_offset_and_network_instance(self):
        self.assertEqual(self.check_clock(record=True).returncode, 0)
        self.write_genesis()
        self.assertEqual(self.check_clock().returncode, 0)
        self.env["COSMOS_LOCAL_CARDANO_NETWORK_ID"] = "reset-network-instance"
        failed = self.check_clock()
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("--chain-flag stateful=false", failed.stderr)
        self.env["COSMOS_LOCAL_CARDANO_NETWORK_ID"] = "first-network-instance"
        self.env["DEVKIT_CLOCK_OFFSET"] = "-3599s"
        self.assertNotEqual(self.check_clock().returncode, 0)

    def test_unbound_existing_state_cannot_be_adopted_by_devkit(self):
        self.write_genesis()
        self.assertNotEqual(self.check_clock().returncode, 0)

    def test_clock_state_cannot_be_started_with_real_time(self):
        self.assertEqual(self.check_clock(record=True).returncode, 0)
        self.env.update(COSMOS_LOCAL_CLOCK_MODE="real", DEVKIT_CLOCK_OFFSET="",
                        COSMOS_LOCAL_CARDANO_NETWORK_ID="")
        self.assertNotEqual(self.check_clock("0").returncode, 0)

    def test_existing_real_clock_home_still_works_without_a_marker(self):
        self.write_genesis()
        self.env.update(COSMOS_LOCAL_CLOCK_MODE="real", DEVKIT_CLOCK_OFFSET="",
                        COSMOS_LOCAL_CARDANO_NETWORK_ID="")
        self.assertEqual(self.check_clock("0").returncode, 0)

    def test_wrong_image_or_unsupported_profile_cannot_start_clock_mode(self):
        self.assertNotEqual(self.check_clock("0").returncode, 0)
        self.env["PROFILE"] = "v10-classic"
        self.assertNotEqual(self.check_clock().returncode, 0)

    def test_changed_genesis_is_rejected_even_with_a_matching_marker(self):
        self.assertEqual(self.check_clock(record=True).returncode, 0)
        self.genesis.write_text('{"chain_id":"unrelated","genesis_time":"2025-01-01T00:00:00Z"}')
        self.assertNotEqual(self.check_clock().returncode, 0)

    def test_invalid_offset_or_future_genesis_is_rejected(self):
        for offset in ("", "-1h", "3600s", "-36;00s", "-03600s"):
            self.env["DEVKIT_CLOCK_OFFSET"] = offset
            self.assertNotEqual(self.check_clock().returncode, 0)
        self.env["DEVKIT_CLOCK_OFFSET"] = "-3600s"
        self.env["GENESIS_TIME"] = "2200-01-01T00:00:00Z"
        self.assertNotEqual(self.check_clock().returncode, 0)


if __name__ == "__main__":
    unittest.main()
