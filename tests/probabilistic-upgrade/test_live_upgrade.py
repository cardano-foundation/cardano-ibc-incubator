"""Orchestration regressions; mocked commands do not constitute live evidence."""

import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "chains/cosmos/scripts/run_light_client_upgrade.sh"


def fake(role, args):
    directory = Path(os.environ["FAKE_UPGRADE_DIR"])
    state_file = directory / "state.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {"created": False, "upgraded": False, "transfers": 0}
    fault = os.environ.get("FAKE_UPGRADE_FAULT", "")
    with (directory / "events.log").open("a") as events:
        events.write(json.dumps([role, *args]) + "\n")

    def emit(value):
        state_file.write_text(json.dumps(state))
        if role == "hermes":
            print(json.dumps({"level": "INFO", "message": "log before envelope"}))
            value = {"status": "success", "result": value}
        print(json.dumps(value))

    def arg(name):
        return args[args.index(name) + 1]

    if role == "control":
        if args == ["start"]:
            emit({})
        elif args == ["upgrade"]:
            state["upgraded"] = True
            emit({})
        elif args == ["identity"]:
            after = state["upgraded"]
            emit({"binary_sha256": ("b" if after and fault != "same-binary" else "a") * 64,
                  "modules": {"adapter": {"version": "v0.1.8" if after and fault == "changed-module" else "v0.1.7", "commit": "c"*40},
                              "core": {"version": "v0.1.5", "commit": "c"*40}}})
        else:
            raise ValueError(args)
    elif role == "transfer":
        assert os.environ["CARDANO_CLIENT_ID"] == "08-cardano-probabilistic-0"
        assert os.environ["COSMOS_CARDANO_CHANNEL_ID"] == "channel-2"
        assert os.environ["CARDANO_COSMOS_CHANNEL_ID"] == "channel-1"
        if state["upgraded"] and fault == "failed-transfer":
            sys.exit(1)
        state["transfers"] += 1
        emit({})
    elif role == "hermes":
        args = args[1:]  # --json
        cmd = " ".join(args[:3])
        if cmd.startswith("create channel "):
            assert not state["upgraded"]
            state["created"] = True
            emit({"a_side": {"channel_id": "channel-1"}, "b_side": {"channel_id": "channel-2"}})
        elif cmd == "query channel end":
            emit({"state": "Open", "ordering": "Unordered", "connection_hops": ["connection-0"], "version": "ics20-1"})
        elif cmd == "query connection end":
            emit({"state": "Open", "client_id": "08-cardano-probabilistic-1" if state["upgraded"] and fault == "retargeted" else "08-cardano-probabilistic-0"})
        elif cmd.startswith("query clients "):
            ids = ["07-tendermint-0"] if arg("--host-chain") == "cardano-devnet" else (["08-cardano-probabilistic-0"] if state["created"] else [])
            if state["upgraded"] and fault == "new-cardano-client" and arg("--host-chain") == "cardano-devnet":
                ids.append("07-tendermint-1")
            emit(ids)
        elif cmd == "query packet commitments":
            emit({"height": {"revision_height": 100}, "seqs": []})
        elif cmd == "query client state":
            height = 100 + 10 * state["transfers"]
            if fault == "no-update" and state["upgraded"]:
                height = 110
            stake = [{"relative_stake_numerator": 1, "relative_stake_denominator": 1}]
            emit({"latest_height": {"revision_height": height}, "latest_checkpoint_height": {"revision_height": height},
                  "trusting_period": {"secs": 86400, "nanos": 0}, "active_slot_coefficient_numerator": 1,
                  "active_slot_coefficient_denominator": 20, "epoch_stake_distribution": stake,
                  "epoch_contexts": [{"stake_distribution": stake}], "max_clock_drift": {"secs": 60, "nanos": 0},
                  "latest_checkpoint_slot": height, "latest_checkpoint_timestamp": height*1000000000})
        else:
            raise ValueError(args)
    elif role == "simd":
        cmd = " ".join(args[:3])
        if cmd == "keys show relayer":
            emit({"address": "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt"})
        elif cmd == "query ibc client":
            emit({"status": "Active"})
        elif cmd == "query bank balances":
            amount = 12345 * state["transfers"]
            if state["upgraded"] and fault == "lost-voucher":
                amount -= 1
            denom = "ibc/" + ("B" if fault == "new-denom" and state["transfers"] == 2 else "A")*64
            emit({"balances": [{"denom": denom, "amount": str(amount)}]})
        elif cmd == "query ibc-transfer denom-trace":
            emit({"denom_trace": {"path": "transfer/channel-2", "base_denom": "mock-token"}})
        elif cmd == "query ibc-transfer denom":
            emit({"denom": {"base": "mock-token", "trace": [{"port_id": "transfer", "channel_id": "channel-2"}]}})
        elif cmd == "query ibc channel":
            emit({"next_sequence_send": "1", "next_sequence_receive": str(state["transfers"] + 1)})
        else:
            raise ValueError(args)
    else:
        raise ValueError(role)


class LiveUpgradeTests(unittest.TestCase):
    def scenario(self, fault="", profile="v8-classic"):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            env = dict(os.environ, FAKE_UPGRADE_DIR=tmp, FAKE_UPGRADE_FAULT=fault,
                       COSMOS_PROFILE=profile, COSMOS_CHAIN_ID=profile+"-1", CARDANO_CHAIN_ID="cardano-devnet",
                       UPGRADE_EVIDENCE_DIR=str(directory / "evidence"), CARDANO_SEND_DENOM="mock-token",
                       UPGRADE_QUERY_TIMEOUT_SECONDS="5", UPGRADE_COMMAND_TIMEOUT_SECONDS="5")
            for role, var in [("control", "UPGRADE_CONTROL_SCRIPT"), ("simd", "SIMD_BIN"), ("hermes", "HERMES_BIN"), ("transfer", "DIRECT_TOKEN_SWAP_SCRIPT")]:
                executable = directory / role
                executable.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, str(Path(__file__).resolve()), "--fake", role]) + ' "$@"\n')
                executable.chmod(0o755)
                env[var] = str(executable)
            handler = directory / "handler.json"
            handler.write_text('{"tokens":{"mock":"mock-token"}}')
            env["HANDLER_JSON"] = str(handler)
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=45)
            if fault:
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse((directory / "evidence/PASS").exists())
            else:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue((directory / "evidence/PASS").exists())
                events = [json.loads(line) for line in (directory / "events.log").read_text().splitlines()]
                self.assertEqual(sum(event[:2] == ["control", "upgrade"] for event in events), 1)
                upgrade_index = next(i for i,e in enumerate(events) if e[:2] == ["control", "upgrade"])
                self.assertTrue(any(e[0] == "transfer" for e in events[:upgrade_index]))
                self.assertTrue(any(e[0] == "transfer" for e in events[upgrade_index:]))
                self.assertFalse(any("create" in e for e in events[upgrade_index:]))

    def test_both_classic_profiles(self):
        for profile in ["v8-classic", "v10-classic"]:
            with self.subTest(profile=profile):
                self.scenario(profile=profile)

    def test_fail_closed(self):
        for fault in ["same-binary", "changed-module", "retargeted", "new-cardano-client", "lost-voucher", "new-denom", "no-update", "failed-transfer"]:
            with self.subTest(fault=fault):
                self.scenario(fault=fault)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--fake":
        fake(sys.argv[2], sys.argv[3:])
    else:
        unittest.main()
