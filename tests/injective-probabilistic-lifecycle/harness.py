#!/usr/bin/env python3
"""Run signed transactions against a separate local Injective application."""

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
        if getattr(self, "data_volume", None):
            cmd[-1:-1] = ["-v", self.data_volume + ":/out/" + self.home.name + "/data"]
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
        if "shared_objects" in bootstrap:
            genesis["app_state"]["08-cardano-probabilistic"] = bootstrap["shared_objects"]
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
        for attempt in range(5):
            validation = self.cli("genesis", "validate", check=False)
            if validation.returncode == 0:
                break
            error = validation.stderr or validation.stdout
            # Retry the transient TOML read failure observed after atomic
            # config replacements on shared Docker mounts.
            if 'toml: basic string not terminated' not in error or attempt == 4:
                raise RuntimeError(error)
            time.sleep(0.2)

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
