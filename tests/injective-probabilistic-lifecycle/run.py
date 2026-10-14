#!/usr/bin/env python3
"""Run signed transactions against a separate local Injective application."""

import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text())


def write(path, data):
    write_text(path, json.dumps(data, indent=2) + "\n")


def write_text(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


class Node:
    def __init__(self, root, image, profile, port, scenario="capacity"):
        self.root = root.resolve()
        self.image = image
        self.profile = profile
        self.port = port
        directory = profile if scenario == "capacity" else profile + "-" + scenario
        self.name = "cardano-injective-probe-" + directory
        self.home = self.root / directory
        self.home.mkdir(exist_ok=True)
        (self.home / "config").mkdir(exist_ok=True)
        self.evidence = read(self.home / "transactions.json") if (self.home / "transactions.json").exists() else []
        self.running = False
        self.operator = (self.root / "operator-address.txt").read_text().strip()

    def command(self, *args, check=True):
        cmd = ["docker", "run", "--rm", "-i", "-v", f"{self.root}:/out", self.image]
        stdin = "local-test-only\n" if "unsafe-import-eth-key" in args else None
        result = subprocess.run(cmd + list(args), input=stdin, text=True, capture_output=True)
        if check and result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        return result

    def cli(self, *args, check=True):
        if self.running:
            result = subprocess.run(["docker", "exec", self.name, "injectived", *args,
                                     "--home", "/out/" + self.home.name], text=True, capture_output=True)
            if check and result.returncode:
                raise RuntimeError(result.stderr or result.stdout)
            return result
        return self.command(*args, "--home", "/out/" + self.home.name, check=check)

    def rpc(self, method, params=None):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}",
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode(),
            {"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        if "error" in result:
            raise RuntimeError(json.dumps(result["error"]))
        return result["result"]

    def initialize(self, bootstrap):
        if (self.home / "config/genesis.json").exists():
            raise RuntimeError("Use a fresh output directory to avoid changing persisted genesis")
        subprocess.run(["docker", "run", "--rm", "--entrypoint", "mkdir", "-v", f"{self.root}:/out",
                        self.image, "-p", "/out/" + self.home.name + "/config"], check=True, capture_output=True)
        self.cli("init", self.name, "--chain-id", "injective-777")
        # This deterministic key is public test data. No public-chain transaction is sent.
        key = (self.root / "operator-key.hex").read_text().strip()
        self.cli("keys", "unsafe-import-eth-key", "operator", key, "--keyring-backend", "test")
        address = bootstrap["operator"]
        self.cli("genesis", "add-genesis-account", address,
                 "1000000000000000000000000000000inj,100000000000000000000stake", "--chain-id", "injective-777")
        self.cli("genesis", "gentx", "operator", "50000000000000000000stake",
                 "--chain-id", "injective-777", "--keyring-backend", "test")
        self.cli("genesis", "collect-gentxs")
        path = self.home / "config/genesis.json"
        genesis = read(path)
        genesis["genesis_time"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 300))
        consensus = read(self.root / "network-snapshot/consensus-params.json")["params"]
        txfees = read(self.root / "network-snapshot/txfees-params.json")["params"]
        # Genesis uses the CometBFT duration representation rather than protobuf JSON.
        genesis["consensus"]["params"]["block"] = consensus["block"]
        genesis["consensus"]["params"]["evidence"].update(
            max_age_num_blocks="100000", max_age_duration="172800000000000", max_bytes="1048576")
        genesis["app_state"]["txfees"]["params"] = txfees
        if self.profile == "local":
            genesis["consensus"]["params"]["block"].update(max_bytes="16777216", max_gas="600000000")
            genesis["app_state"]["txfees"]["params"]["max_gas_wanted_per_tx"] = "600000000"
        ibc = genesis["app_state"]["ibc"]["client_genesis"]
        if "*" not in ibc["params"]["allowed_clients"]:
            ibc["params"]["allowed_clients"].append("08-cardano-probabilistic")
        ibc["clients"] = bootstrap.get("clients", [bootstrap["client"]])
        ibc["clients_consensus"] = bootstrap.get("consensuses", [bootstrap["consensus"]])
        ibc["clients_metadata"] = bootstrap.get("metadatas", [bootstrap["metadata"]])
        ibc["next_client_sequence"] = str(len(ibc["clients"]))
        # The capacity runs do not need governance. Lifecycle uses the captured public period.
        if "gov" in genesis["app_state"]:
            governance = read(self.root / "network-snapshot/gov-params.json")["params"]
            # This older fork rejects the current network's equal expedited deposit.
            # Keep both voting periods and every capacity parameter unchanged.
            if governance["expedited_min_deposit"] == governance["min_deposit"]:
                governance["expedited_min_deposit"][0]["amount"] = str(int(governance["min_deposit"][0]["amount"]) + 1)
                write(self.home / "governance-genesis-adjustment.json", governance)
            genesis["app_state"]["gov"]["params"] = governance
        if "connection" in bootstrap:
            connection = genesis["app_state"]["ibc"]["connection_genesis"]
            connection["connections"] = [bootstrap["connection"]]
            connection["client_connection_paths"] = [{"client_id": "08-cardano-probabilistic-0", "paths": ["connection-0"]}]
            connection["next_connection_sequence"] = "1"
        write(path, genesis)
        config = self.home / "config/config.toml"
        text = config.read_text()
        text = re.sub(r"^max_tx_bytes = .*", "max_tx_bytes = 12582912", text, flags=re.M)
        text = re.sub(r"^max_body_bytes = .*", "max_body_bytes = 20000000", text, flags=re.M)
        text = re.sub(r"^timeout_commit = .*", 'timeout_commit = "500ms"', text, flags=re.M)
        write_text(config, text)
        app = self.home / "config/app.toml"
        text = app.read_text()
        text = re.sub(r"^max-recv-msg-size = .*", "max-recv-msg-size = 16777216", text, flags=re.M)
        text = re.sub(r"^rpc-max-body-bytes = .*", "rpc-max-body-bytes = 20000000", text, flags=re.M)
        write_text(app, text)
        self.cli("genesis", "validate")

    def start(self):
        subprocess.run(["docker", "run", "-d", "--name", self.name, "-p", f"127.0.0.1:{self.port}:26657",
                        "-v", f"{self.root}:/out", self.image, "start", "--home", "/out/" + self.home.name,
                        "--rpc.laddr", "tcp://0.0.0.0:26657", "--minimum-gas-prices", "500000000inj"],
                       check=True, capture_output=True)
        self.running = True
        for _ in range(120):
            try:
                if int(self.rpc("status")["sync_info"]["latest_block_height"]) >= 2:
                    return
            except (OSError, RuntimeError):
                pass
            time.sleep(0.5)
        raise RuntimeError("Injective did not start, inspect its saved node log")

    def stop(self):
        with (self.home / "node.log").open("w") as output:
            subprocess.run(["docker", "logs", self.name], stdout=output, stderr=subprocess.STDOUT)
        subprocess.run(["docker", "stop", self.name], capture_output=True)
        subprocess.run(["docker", "rm", self.name], capture_output=True)
        self.running = False

    def helper(self, *args):
        result = subprocess.run(["docker", "run", "--rm", "-v", f"{self.root}:/out", self.helper_image, *args],
                                text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout

    def decoded_state(self, label):
        saved = self.home / (label + "-state.json")
        if saved.exists():
            return read(saved)
        path = self.home / (label + "-state.pb")
        path.write_bytes(self.state())
        state = json.loads(self.helper("decode", "/out/" + self.home.name + "/" + path.name))
        write(self.home / (label + "-state.json"), state)
        return state

    def wait_deadline(self, state):
        deadline = max(int(context["usable_after_unix_ns"]) for context in state["epoch_context_challenges"])
        while time.time_ns() <= deadline + 1000000000:
            time.sleep(min(10, max(0.1, (deadline - time.time_ns()) / 1e9)))
        return deadline

    def lifecycle(self):
        directory = self.root / "lifecycle"
        gas = 75000000 if self.profile == "testnet" else 600000000

        def send(name, error=None, label=None):
            label = label or name
            previous = next((entry for entry in self.evidence if entry["label"] == label), None)
            result = previous or self.send(directory / (name + ".json"), label, gas)
            committed = result["committed"]
            if error:
                failure = json.dumps(result["check_tx"]) if not committed else committed["tx_result"]["log"]
                assert error.lower() in failure.lower(), failure[:1000]
                assert not result["client_changed"]
            else:
                assert committed and committed["tx_result"]["code"] == 0, name
            return result

        for name in ["channel-init", "channel-ack", "baseline-subject", "baseline-control", "recv-packet-967-1"]:
            send(name)
        send("proposal")
        proposed = self.decoded_state("proposal")
        send("honest")
        challenge = send("challenge")
        frozen = self.decoded_state("frozen")
        assert int(frozen["frozen_height"].get("revision_height", 0)) > 0
        deadline = max(int(context["usable_after_unix_ns"]) for context in proposed["epoch_context_challenges"])
        block_time = self.rpc("block", {"height": challenge["committed"]["height"]})["block"]["header"]["time"]
        committed_ns = int(datetime.datetime.fromisoformat(block_time.replace("Z", "+00:00")).timestamp() * 1e9)
        assert committed_ns < deadline, "Challenge missed the stored response window"
        write(self.home / "freeze.json", {"deadline_unix_ns": deadline, "observed_committed_time": block_time,
                                          "frozen_height": frozen["frozen_height"]})
        send("recv-packet-1032-2", "frozen", "frozen-packet")
        control = self.store("clients/08-cardano-probabilistic-1/clientState")
        consensus = self.store("clients/08-cardano-probabilistic-1/consensusStates/0-1001")
        assert consensus
        (directory / "substitute-client.pb").write_bytes(control)
        (directory / "substitute-consensus.pb").write_bytes(consensus)
        self.helper("create", "/out/lifecycle/substitute-client.pb", "/out/lifecycle/substitute-consensus.pb", "/out/lifecycle")
        send("create-substitute")
        replacement = read(directory / "replacement.json")
        replacement["body"]["messages"][0]["client_id"] = "08-cardano-probabilistic-2"
        write(directory / "replacement.json", replacement)
        send("replacement")
        send("unauthorized-recovery", "unauthorized")
        # Expedited governance keeps the captured 300-second voting period.
        send("governance-recovery")
        send("vote-recovery")
        for _ in range(48):
            proposal = json.loads(self.cli("query", "gov", "proposal", "1", "--node", "http://127.0.0.1:26657", "--output", "json").stdout)
            write(self.home / "governance-result.json", proposal)
            if "PROPOSAL_STATUS_PASSED" in json.dumps(proposal):
                break
            if "PROPOSAL_STATUS_FAILED" in json.dumps(proposal) or "PROPOSAL_STATUS_REJECTED" in json.dumps(proposal):
                raise RuntimeError(json.dumps(proposal))
            time.sleep(10)
        else:
            raise RuntimeError("Recovery governance did not finish")
        recovered = self.decoded_state("recovered")
        assert int(recovered["frozen_height"].get("revision_height", 0)) == 0
        assert recovered["latest_height"]["revision_height"] == "1032"
        for height in [966, 967, 1001]:
            assert not self.store(f"clients/08-cardano-probabilistic-0/consensusStates/0-{height}")
        send("recv-packet-1032-2", "pending", "pending-recovery-packet")
        self.wait_deadline(recovered)
        send("recv-packet-1001-2", "processed time not found", "quarantined-proof")
        send("ordinary")
        send("recv-packet-1063-2")
        send("recv-packet-1063-3")
        before_restart = self.state()
        self.stop()
        self.start()
        assert self.state() == before_restart
        write(self.home / "restart.json", {"client_restored": True, "host_height": self.rpc("status")["sync_info"]["latest_block_height"]})
        for sequence in [1, 2, 3]:
            assert self.store(f"receipts/ports/transfer/channels/channel-0/sequences/{sequence}") == b"\x01"
            assert self.store(f"acks/ports/transfer/channels/channel-0/sequences/{sequence}") == hashlib.sha256(b'{"result":"AQ=="}').digest()
        balance = self.cli("query", "bank", "balances", self.operator, "--node", "http://127.0.0.1:26657", "--output", "json")
        balances = json.loads(balance.stdout)
        write(self.home / "post-recovery-balances.json", balances)
        voucher = "ibc/" + hashlib.sha256(b"transfer/channel-0/lovelace").hexdigest().upper()
        assert any(coin["denom"] == voucher and coin["amount"] == "300" for coin in balances["balances"])
        write(self.home / "lifecycle-result.json", {"freeze_committed": True, "authorized_recovery_committed": True,
                                                  "old_consensus_quarantined": True, "packets_received": [1, 2, 3],
                                                  "restart_preserved_state": True})

    def store(self, key):
        result = self.rpc("abci_query", {"path": "/store/ibc/key", "data": key.encode().hex(), "prove": False})
        if result["response"].get("code", 0):
            raise RuntimeError(result["response"].get("log"))
        return base64.b64decode(result["response"].get("value") or "")

    def state(self):
        return self.store("clients/08-cardano-probabilistic-0/clientState")

    def send(self, source, label, gas=600000000):
        before = self.state()
        account = json.loads(self.cli("query", "auth", "account", self.operator,
                                     "--node", "http://127.0.0.1:26657", "--output", "json").stdout)
        write(self.home / (label + "-account.json"), account)
        # Offline signing uses the node's persisted eth account number and sequence.
        def base_account(value):
            if "address" in value:
                return {"account_number": str(value.get("account_number", "0")), "sequence": str(value.get("sequence", "0"))}
            for child in value.values():
                if isinstance(child, dict):
                    found = base_account(child)
                    if found:
                        return found
            return None
        account = base_account(account)
        unsigned = read(source)
        unsigned["auth_info"]["fee"] = {"amount": [{"denom": "inj", "amount": str(gas * 500000000)}], "gas_limit": str(gas), "payer": "", "granter": ""}
        unsigned_path = self.home / (label + "-unsigned.json")
        signed_path = self.home / (label + "-signed.json")
        write(unsigned_path, unsigned)
        signed = self.cli("tx", "sign", "/out/" + self.home.name + "/" + unsigned_path.name,
                          "--from", "operator", "--keyring-backend", "test", "--chain-id", "injective-777",
                          "--offline", "--account-number", account["account_number"], "--sequence", account["sequence"])
        write_text(signed_path, signed.stdout)
        encoded = self.cli("tx", "encode", "/out/" + self.home.name + "/" + signed_path.name).stdout.strip()
        raw = base64.b64decode(encoded)
        (self.home / (label + ".tx")).write_bytes(raw)
        simulated = self.cli("tx", "simulate", "/out/" + self.home.name + "/" + unsigned_path.name,
                             "--from", "operator", "--keyring-backend", "test", "--chain-id", "injective-777",
                             "--node", "http://127.0.0.1:26657", "--output", "json", check=False)
        simulation = {"exit_code": simulated.returncode, "stdout": simulated.stdout, "stderr": simulated.stderr}
        write(self.home / (label + "-simulation.json"), simulation)
        started = time.time()
        try:
            admitted = self.rpc("broadcast_tx_sync", {"tx": encoded})
        except (OSError, RuntimeError) as error:
            admitted = {"error": str(error)}
        committed = None
        if admitted.get("code") == 0:
            for _ in range(120):
                try:
                    committed = self.rpc("tx", {"hash": base64.b64encode(bytes.fromhex(admitted["hash"])).decode(), "prove": False})
                    break
                except (OSError, RuntimeError):
                    time.sleep(0.5)
        after = self.state()
        if committed:
            committed.pop("tx", None)
        (self.home / (label + "-client.pb")).write_bytes(after)
        record = {"label": label, "profile": self.profile, "signed_tx_bytes": len(raw), "gas_wanted": gas,
                  "simulation": simulation, "check_tx": admitted, "committed": committed,
                  "client_changed": before != after, "elapsed_seconds": time.time() - started}
        self.evidence.append(record)
        write(self.home / "transactions.json", self.evidence)
        print(json.dumps({k: v for k, v in record.items() if k not in ["simulation", "committed"]}), flush=True)
        if committed:
            result = committed["tx_result"]
            print(json.dumps({"label": label, "height": committed["height"], "code": result["code"],
                              "gas_used": result["gas_used"], "log": result["log"][:500]}), flush=True)
        return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--image", default="local/cardano-injective-release")
    parser.add_argument("--profile", choices=["testnet", "local"], required=True)
    parser.add_argument("--port", type=int, default=28657)
    parser.add_argument("--scenario", choices=["capacity", "lifecycle"], default="capacity")
    parser.add_argument("--helper-image", default="local/cardano-injective-release-probe")
    parser.add_argument("--fixture", choices=["limit", "size", "count", "control"], default="limit")
    args = parser.parse_args()
    scenario = args.scenario if args.fixture == "limit" or args.scenario == "lifecycle" else "capacity-" + args.fixture
    node = Node(args.output, args.image, args.profile, args.port, scenario)
    node.helper_image = args.helper_image
    fixture = args.fixture if args.scenario == "capacity" else "lifecycle"
    node.initialize(read(args.output / fixture / "bootstrap.json"))
    try:
        node.start()
        write(node.home / "runtime-consensus.json", node.rpc("consensus_params"))
        if args.scenario == "lifecycle":
            node.lifecycle()
        else:
            node.send(args.output / fixture / "proposal.json", fixture + "-proposal", gas=75000000 if args.profile == "testnet" else 600000000)
            node.send(args.output / fixture / "challenge.json", fixture + "-challenge", gas=75000000 if args.profile == "testnet" else 600000000)
    finally:
        node.stop()


if __name__ == "__main__":
    main()
