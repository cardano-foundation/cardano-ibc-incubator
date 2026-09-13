#!/usr/bin/env python3
"""Provision Caribic's five-producer Cardano network through Yaci DevKit."""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import uuid


PROFILE = Path(__file__).resolve().parent
ROOT = PROFILE.parents[2]
PORTS = {
    "DEVKIT_ADMIN_PORT": "10080",
    "DEVKIT_NODE_PORT": "13001",
    "DEVKIT_OGMIOS_PORT": "11337",
    "DEVKIT_KUPO_PORT": "11442",
    "DEVKIT_HISTORY_PORT": "18081",
    "DEVKIT_HISTORY_DB_PORT": "15432",
    "DEVKIT_GATEWAY_DB_PORT": "15433",
    "DEVKIT_NONCE_PORT": "18082",
}
DEFAULTS = {**PORTS, "DEVKIT_HOST": "127.0.0.1"}
PRODUCERS = tuple(f"producer-{index}" for index in range(2, 6))


def read_settings(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, separator, value = line.partition("=")
            if not separator or key not in DEFAULTS:
                raise ValueError(f"Unsupported DevKit setting in {path}: {key}")
            values[key] = value.strip()
    return values


def validate_settings(values):
    for key in PORTS:
        value = values[key]
        if not value.isdecimal() or not 1024 <= int(value) <= 65535:
            raise ValueError(f"{key} must be a port between 1024 and 65535")
    if len({int(values[key]) for key in PORTS}) != len(PORTS):
        raise ValueError("DevKit ports must be distinct")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", values["DEVKIT_HOST"]):
        raise ValueError("DEVKIT_HOST must be a hostname or IPv4 address")
    return values


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def write_env(path, values):
    path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    path.chmod(0o600)


def http(url, data=None, timeout=15):
    request = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def wait_for(label, probe, timeout=180):
    deadline = time.monotonic() + timeout
    last_error = "not ready"
    next_log = 0
    while time.monotonic() < deadline:
        try:
            result = probe()
            if result:
                return result
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            last_error = str(error)
        if time.monotonic() >= next_log:
            print(f"Waiting for {label}...", flush=True)
            next_log = time.monotonic() + 15
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for {label}: {last_error}")


def normalized_genesis(genesis):
    # DevKit fixes the keys and settings but selects wall-clock time on reset.
    value = json.loads(json.dumps(genesis))
    value["byron"].pop("startTime", None)
    value["shelley"].pop("systemStart", None)
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def block_production_ready(endpoint):
    health = http(endpoint + "/health")
    tip = health.get("lastKnownTip")
    return (health.get("connectionStatus") == "connected" and isinstance(tip, dict)
            and tip.get("height", 0) > 0)


class Runtime:
    def __init__(self, root=ROOT):
        self.root = root.resolve()
        self.state = self.root / ".caribic/devkit"
        self.state.mkdir(parents=True, exist_ok=True)
        # No shared container names, networks, volumes, or operator configuration.
        suffix = hashlib.sha256(str(self.root).encode()).hexdigest()[:12]
        self.project = f"caribic-devkit-{suffix}"
        self.settings_path = self.state / "runtime.env"
        settings = read_settings(self.settings_path)
        if not settings:
            settings = {**DEFAULTS, **read_settings(PROFILE / ".env")}
            settings.update({key: os.environ[key] for key in DEFAULTS if key in os.environ})
        else:
            settings = {**DEFAULTS, **settings}
        self.settings = validate_settings(settings)

    def compose(self, *args, capture=False):
        # Explicit file and project selection also protect stop/reset from ambient
        # COMPOSE_FILE / COMPOSE_PROJECT_NAME values in the caller's shell.
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("COMPOSE_") and key not in DEFAULTS}
        env.update(self.settings)
        clock_path = self.state / "clock-offset"
        if clock_path.exists():
            env["DEVKIT_CLOCK_OFFSET"] = clock_path.read_text().strip()
        result = subprocess.run(
            ["docker", "compose", "--project-name", self.project,
             "--file", str(PROFILE / "compose.yaml"), *args],
            env=env, text=True, capture_output=capture, check=True,
        )
        return result.stdout.strip() if capture else None

    def cli(self, *args):
        return self.compose("exec", "-T", "devkit", "cardano-cli", *args, capture=True)

    def endpoint(self, port):
        return f'http://{self.settings["DEVKIT_HOST"]}:{self.settings[port]}'

    def ogmios(self, method, params=None, follow_up=None):
        response = subprocess.run(
            ["node", str(PROFILE / "ogmios.mjs"), self.endpoint("DEVKIT_OGMIOS_PORT"), method,
             *([follow_up] if follow_up else [])],
            input=json.dumps(params or {}), text=True, capture_output=True, timeout=20,
        )
        if response.returncode:
            raise RuntimeError(response.stderr.strip())
        return json.loads(response.stdout)

    def sql(self, query):
        return self.compose("exec", "-T", "history-db", "psql", "-v", "ON_ERROR_STOP=1",
                            "-U", "yaci", "-d", "yaci_store", "-Atc", query, capture=True)

    def export_endpoints(self):
        host = self.settings["DEVKIT_HOST"]
        ogmios = self.endpoint("DEVKIT_OGMIOS_PORT")
        kupo = self.endpoint("DEVKIT_KUPO_PORT")
        admin = self.endpoint("DEVKIT_ADMIN_PORT") + "/local-cluster/api/admin/devnet/genesis/"
        genesis = {era: http(admin + era) for era in ("byron", "shelley")}
        instance_path = self.state / "instance-id"
        if not instance_path.exists():
            instance_path.write_text(uuid.uuid4().hex)
        # Fixed genesis keys/timing can repeat on reset. Bind dependent Cosmos
        # state to this network instance as well as its actual genesis.
        network_id = hashlib.sha256((json.dumps(genesis, sort_keys=True, separators=(",", ":"))
                                     + instance_path.read_text()).encode()).hexdigest()
        values = {
            "CARDANO_LOCAL_CLOCK_OFFSET": (self.state / "clock-offset").read_text().strip(),
            "CARDANO_SYSTEM_START": genesis["shelley"]["systemStart"],
            "CARDANO_LOCAL_NETWORK_ID": network_id,
            "CARDANO_CHAIN_ID": "cardano-devnet",
            "CARDANO_NETWORK_MAGIC": "42", "CARDANO_CHAIN_NETWORK_MAGIC": "42",
            "CARDANO_CHAIN_HOST": host, "CARDANO_CHAIN_PORT": self.settings["DEVKIT_NODE_PORT"],
            "OGMIOS_ENDPOINT": ogmios, "KUPO_ENDPOINT": kupo,
            "OGMIOS_URL": ogmios, "KUPO_URL": kupo,
            "CARIBIC_OGMIOS_URL": ogmios, "CARIBIC_KUPO_URL": kupo,
            "YACI_STORE_ENDPOINT": self.endpoint("DEVKIT_HISTORY_PORT"),
            "DEVKIT_ADMIN_ENDPOINT": self.endpoint("DEVKIT_ADMIN_PORT"),
            "HISTORY_DB_HOST": host, "HISTORY_DB_PORT": self.settings["DEVKIT_HISTORY_DB_PORT"],
            "HISTORY_DB_NAME": "yaci_store", "HISTORY_DB_USERNAME": "yaci",
            "HISTORY_DB_PASSWORD": "devkit", "CARDANO_EPOCH_LENGTH": "600",
            "GATEWAY_DB_HOST": host, "GATEWAY_DB_PORT": self.settings["DEVKIT_GATEWAY_DB_PORT"],
            "GATEWAY_DB_NAME": "gateway_app", "GATEWAY_DB_USERNAME": "postgres",
            "GATEWAY_DB_PASSWORD": "postgres",
            "CARDANO_EPOCH_PARAMS_ENDPOINT": self.endpoint("DEVKIT_NONCE_PORT"),
            "CARDANO_LOCAL_EPOCH_CONTEXT_ENDPOINT": self.endpoint("DEVKIT_NONCE_PORT"),
        }
        write_env(self.state / "endpoints.env", values)
        container = {**values, "OGMIOS_ENDPOINT": "http://devkit:1337",
                     "KUPO_ENDPOINT": "http://devkit:1442",
                     "OGMIOS_URL": "http://devkit:1337", "KUPO_URL": "http://devkit:1442",
                     "CARDANO_CHAIN_HOST": "devkit", "CARDANO_CHAIN_PORT": "3001",
                     "YACI_STORE_ENDPOINT": "http://history:8080",
                     "HISTORY_DB_HOST": "history-db", "HISTORY_DB_PORT": "5432",
                     "GATEWAY_DB_HOST": "gateway-db", "GATEWAY_DB_PORT": "5432",
                     "CARDANO_EPOCH_PARAMS_ENDPOINT": "http://nonce:8080",
                     "CARDANO_LOCAL_EPOCH_CONTEXT_ENDPOINT": "http://nonce:8080",
                     "CARDANO_DOCKER_NETWORK": self.project + "_default",
                     "GATEWAY_COMPOSE_PROJECT": self.project + "-gateway",
                     "GATEWAY_CONTAINER_NAME": self.project + "-gateway-app",
                     "GATEWAY_HISTORY_CONTAINER_NAME": self.project + "-bridge-history-sync",
                     "DAPP_COMPOSE_PROJECT": self.project + "-dapps",
                     # Only the initial pool is seeded in genesis. The four peers
                     # must retain their actual indexed registration slots.
                     "CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT": "1"}
        write_env(self.state / "container-endpoints.env", container)

    def fund(self, address, lovelace, outputs=1):
        if lovelace < 2_000_000 or not 1 <= outputs <= 100 or lovelace // outputs < 2_000_000:
            raise ValueError("Funding requires at least 2 ADA per output and at most 100 outputs")
        utxos = json.loads(self.cli("query", "utxo", "--address", address,
                                   "--testnet-magic", "42", "--output-json"))
        balance = sum(row["value"]["lovelace"] for row in utxos.values())
        portion = lovelace // outputs
        usable = sum(row["value"].keys() == {"lovelace"} and row["value"]["lovelace"] >= portion
                     for row in utxos.values())
        if balance >= lovelace and (outputs == 1 or usable >= outputs):
            return
        count = max(1, outputs - usable)
        amount = max(portion, (max(0, lovelace - balance) + count - 1) // count)
        # Spend DevKit's existing genesis funds directly. Its HTTP faucet can
        # fail during local-state queries even when the node has usable funds.
        inputs = []
        for key in range(1, 4):
            key_path = f"/clusters/nodes/default/utxo-keys/utxo{key}"
            source = self.cli("address", "build", "--payment-verification-key-file",
                              key_path + ".vkey", "--testnet-magic", "42")
            available = json.loads(self.cli("query", "utxo", "--address", source,
                                           "--testnet-magic", "42", "--output-json"))
            inputs, total = [], 0
            for tx_in, row in sorted(available.items(), key=lambda item: (-item[1]["value"]["lovelace"], item[0])):
                if row["value"].keys() != {"lovelace"}:
                    continue
                inputs.append(tx_in)
                total += row["value"]["lovelace"]
                if total >= amount * count + 3_000_000:
                    break
            if total >= amount * count + 3_000_000:
                break
        else:
            raise RuntimeError("DevKit genesis wallets have insufficient confirmed ADA for funding")
        path = "/tmp/caribic-devkit-fund"
        self.compose("exec", "-T", "devkit", "mkdir", "-p", path)
        try:
            args = ["conway", "transaction", "build", "--testnet-magic", "42"]
            for tx_in in inputs:
                args.extend(("--tx-in", tx_in))
            for _ in range(count):
                args.extend(("--tx-out", f"{address}+{amount}"))
            self.cli(*args, "--change-address", source, "--out-file", path + "/tx.body")
            self.cli("conway", "transaction", "sign", "--tx-body-file", path + "/tx.body",
                     "--signing-key-file", key_path + ".skey", "--out-file", path + "/tx.signed")
            self.cli("conway", "transaction", "submit", "--testnet-magic", "42",
                     "--tx-file", path + "/tx.signed")
            tx_id = self.cli("conway", "transaction", "txid", "--tx-file", path + "/tx.signed")
            wait_for("funding inclusion", lambda: any(key.startswith(tx_id + "#") for key in
                     json.loads(self.cli("query", "utxo", "--address", address,
                                         "--testnet-magic", "42", "--output-json"))))
        finally:
            self.compose("exec", "-T", "devkit", "rm", "-rf", path)

    def start_producers(self):
        # Register sequentially, the native faucet spends shared inputs.
        for service in PRODUCERS:
            self.assert_pool_registration_window(service)
            self.compose("up", "-d", "--build", service)
            address = wait_for(f"{service} keys", lambda: self.compose(
                "exec", "-T", service, "cat", "/clusters/pool-keys/default/payment.addr", capture=True))
            pool_id = self.compose("exec", "-T", service, "cardano-cli", "stake-pool", "id",
                                   "--cold-verification-key-file", "/clusters/pool-keys/default/cold.vkey",
                                   capture=True)
            stake_address = self.compose("exec", "-T", service, "cardano-cli", "stake-address", "build",
                                         "--stake-verification-key-file", "/clusters/pool-keys/default/stake.vkey",
                                         "--testnet-magic", "42", capture=True)
            self.wait_for_pool_registration(service, pool_id, stake_address)
            self.compose("exec", "-T", service, "touch", "/clusters/registered")
            self.fund(address, 300_000_000_000)
        wait_for("five active block producers", self.producers_ready, timeout=2100)

    def resume_provisioned_producers(self):
        # After delegation, main holds only one fifth of the stake. Resume saved
        # peers before its native next-block wait, including after container removal.
        volumes = set(subprocess.run(
            ["docker", "volume", "ls", "--filter", f"label=com.docker.compose.project={self.project}",
             "--format", "{{.Name}}"], text=True, capture_output=True, check=True).stdout.splitlines())
        candidates = [(service, f"{self.project}_{service}-data") for service in PRODUCERS
                      if f"{self.project}_{service}-data" in volumes]
        if not candidates:
            return
        image = self.compose("images", "-q", "devkit", capture=True).splitlines()
        if len(image) != 1:
            raise RuntimeError("Cannot identify this DevKit instance's node image for retained peer inspection")
        retained = []
        for service, volume in candidates:
            result = subprocess.run(
                ["docker", "run", "--rm", "--network", "none", "--read-only",
                 "--mount", f"type=volume,src={volume},dst=/retained,readonly",
                 "--entrypoint", "sh", image[0], "-c",
                 "test -f /retained/registered && "
                 "test -s /retained/nodes/default/cluster-info.json && "
                 "test -s /retained/pool-keys/default/opcert.cert"], capture_output=True)
            if result.returncode == 0:
                retained.append(service)
            elif result.returncode != 1:
                raise RuntimeError(f"Cannot inspect retained {service} state: "
                                   + result.stderr.decode(errors="replace").strip())
        if retained:
            # Only completed registrations start together. Unfinished peers still
            # join/register sequentially in start_producers, using the native faucet.
            self.compose("up", "-d", "--build", *retained)

    def assert_pool_registration_window(self, service):
        offset = int((self.state / "clock-offset").read_text().strip().removesuffix("s"))
        cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
        if time.time() + offset < cutoff:
            return
        # A stopped peer retains its successful registration marker. Check it
        # before starting the native shell, which otherwise registers immediately.
        container = self.compose("ps", "--all", "-q", service, capture=True)
        if container and subprocess.run(["docker", "cp", container + ":/clusters/registered", "-"],
                                        capture_output=True).returncode == 0:
            return
        raise RuntimeError(f"{service} registration is unfinished and the saved chain clock has passed "
                           "the pool registration cutoff, run `caribic devkit reset`")

    def wait_for_pool_registration(self, service, pool_id, stake_address):
        container = self.compose("ps", "-q", service, capture=True)
        started = subprocess.run(["docker", "inspect", "--format", "{{.State.StartedAt}}", container],
                                 text=True, capture_output=True, check=True).stdout.strip()
        restarted = False

        def registered():
            nonlocal restarted
            if self.pool_registered(pool_id, stake_address):
                return True
            if not restarted:
                logs = self.compose("logs", "--no-color", "--since", started, service, capture=True)
                failed = any(error in logs for error in (
                    "com.bloxbean.cardano.client.api.exception.ApiRuntimeException:",
                    "com.bloxbean.cardano.client.exception.InsufficientBalanceException:",
                    "org.springframework.web.client.HttpServerErrorException$InternalServerError:",
                    "org.springframework.web.client.HttpServerErrorException$BadGateway:",
                ))
                if failed:
                    # The native shell leaves its web server running after a
                    # command failure. Restart only this peer, retaining its keys.
                    print(f"{service} native registration failed, restarting that peer once...", flush=True)
                    self.compose("restart", service)
                    restarted = True
            return False

        wait_for(f"{service} registration and delegation", registered, timeout=600)

    def pool_registered(self, pool_id, stake_address):
        rows = json.loads(self.cli("query", "stake-address-info", "--address", stake_address,
                                   "--testnet-magic", "42"))
        return any(row.get("stakeDelegation") == pool_id for row in rows)

    def producers_ready(self):
        snapshot = json.loads(self.cli("query", "stake-snapshot", "--all-stake-pools", "--testnet-magic", "42"))
        active = {pool: value["stakeSet"] for pool, value in snapshot.get("pools", {}).items()
                  if value.get("stakeSet", 0) > 0}
        if len(active) != 5:
            return False
        count = self.sql("SELECT count(DISTINCT slot_leader) FROM "
                         "(SELECT slot_leader FROM block ORDER BY number DESC LIMIT 100) recent")
        return int(count) == 5

    def start(self):
        started = time.monotonic()
        profile_hash = hashlib.sha256(b"".join(
            path.read_bytes() for path in (
                PROFILE / "Dockerfile", PROFILE / "compose.yaml", PROFILE / "node.properties",
                PROFILE / "entrypoint.sh", PROFILE / "cardano-cli.sh",
                PROFILE / "nonce.py", PROFILE / "admin_proxy.py", PROFILE / "cardano_node.py",
                PROFILE.parent / "yaci/config/application.properties",
            )
        )).hexdigest()
        marker = self.state / "profile.sha256"
        if marker.exists() and marker.read_text() != profile_hash:
            raise RuntimeError("DevKit configuration changed, run `caribic devkit reset` to recreate its data")
        marker.write_text(profile_hash)
        write_env(self.settings_path, self.settings)
        clock_path = self.state / "clock-offset"
        if not clock_path.exists():
            # Registration must precede the existing light-client cutoff. Share
            # one offset across processes and retain it when restarting the chain.
            target = datetime(2025, 12, 31, tzinfo=timezone.utc).timestamp()
            clock_path.write_text(f"{int(target - time.time()):+d}s")
        self.compose("up", "-d", "--build", "devkit")
        self.resume_provisioned_producers()
        admin = self.endpoint("DEVKIT_ADMIN_PORT") + "/local-cluster/api/admin/devnet"
        wait_for("DevKit genesis", lambda: http(admin + "/genesis/shelley"))
        wait_for("Ogmios block production", lambda: block_production_ready(self.endpoint("DEVKIT_OGMIOS_PORT")))
        self.compose("up", "-d", "--build", "nonce", "gateway-db")
        self.compose("exec", "-T", "devkit", "sh", "-c",
                     "for era in byron shelley alonzo conway; do "
                     "cp /clusters/nodes/default/node/genesis/$era-genesis.json "
                     "/export/genesis-$era.json; done")
        self.compose("up", "-d", "--build", "history")
        self.export_endpoints()
        # Ten minutes on a fresh network. This avoids DevKit's time-shift and
        # epoch-zero Conway cost-model workaround affecting consensus evidence.
        wait_for("Conway (epoch 1 on a fresh network)", lambda:
                 http(self.endpoint("DEVKIT_OGMIOS_PORT") + "/health").get("currentEra") == "conway",
                 timeout=780)
        wait_for("Kupo", lambda: http(self.endpoint("DEVKIT_KUPO_PORT") + "/health"))
        self.start_producers()
        wait_for("Yaci history", lambda:
                 http(self.endpoint("DEVKIT_HISTORY_PORT") + "/api/v1/blocks/latest").get("epoch", 0) >= 1, timeout=600)
        genesis = {era: http(admin + "/genesis/" + era) for era in ("byron", "shelley", "alonzo", "conway")}
        write_json(self.state / "genesis.json", genesis)
        report = {
            "startup_seconds": round(time.monotonic() - started, 2),
            "genesis_config_sha256": normalized_genesis(genesis),
            "system_start": genesis["shelley"]["systemStart"],
            "network": http(admin),
            "node_version": self.compose("exec", "-T", "devkit", "cardano-node", "--version", capture=True),
            "resources": self.resources(),
        }
        write_json(self.state / "startup.json", report)
        print(f"DevKit is ready. Endpoints: {self.state / 'endpoints.env'}")
        print("Five active producers, Ogmios, Kupo, chain history and epoch nonces are ready.")

    def resources(self):
        ids = self.compose("ps", "-q", capture=True).split()
        if not ids:
            return []
        result = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}", *ids],
                                text=True, capture_output=True, check=True)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def stop(self):
        # Gateway and dapps may still be attached to this externally consumed
        # network when `caribic stop network` is used.
        self.compose("stop")

    def reset(self):
        settings = validate_settings({**DEFAULTS, **read_settings(PROFILE / ".env"),
                                      **{key: os.environ[key] for key in DEFAULTS if key in os.environ}})
        attached = subprocess.run(
            ["docker", "ps", "--filter", "network=" + self.project + "_default",
             "--format", '{{.Label "com.docker.compose.project"}}'],
            text=True, capture_output=True, check=True,
        ).stdout.splitlines()
        if any(project != self.project for project in attached):
            raise RuntimeError("Stop the bridge services before resetting their DevKit network")
        self.compose("down", "--volumes", "--remove-orphans")
        for name in ("runtime.env", "endpoints.env", "container-endpoints.env", "startup.json", "genesis.json", "test.json", "profile.sha256", "clock-offset", "instance-id"):
            (self.state / name).unlink(missing_ok=True)
        self.settings = settings
        self.start()

    def status(self):
        self.compose("ps", "--all")
        print(f"Endpoints: {self.state / 'endpoints.env'}")
        for name in ("startup.json", "test.json"):
            path = self.state / name
            if path.exists():
                print(f"Last recorded {name}:\n{path.read_text()}")

    def test(self):
        if not (self.state / "genesis.json").exists():
            raise RuntimeError("Run `caribic devkit start` first")
        from smoke import run_smoke
        report = run_smoke(self)
        report["resources"] = self.resources()
        write_json(self.state / "test.json", report)
        print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "stop", "reset", "status", "test", "cli", "fund", "running"))
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    runtime = Runtime()
    if args.action == "running":
        sys.exit(0 if runtime.compose("ps", "--status", "running", "-q", capture=True) else 1)
    with (runtime.state / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another DevKit command is running in this checkout")
        if args.action == "cli":
            print(runtime.cli(*args.arguments))
        elif args.action == "fund":
            funding = argparse.ArgumentParser()
            funding.add_argument("address")
            funding.add_argument("lovelace", type=int)
            funding.add_argument("--outputs", type=int, default=1)
            values = funding.parse_args(args.arguments)
            runtime.fund(values.address, values.lovelace, values.outputs)
        else:
            getattr(runtime, args.action)()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"DevKit: {error}", file=sys.stderr)
        sys.exit(2)
