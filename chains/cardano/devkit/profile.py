#!/usr/bin/env python3
"""Caribic's isolated, experimental Yaci DevKit runtime. Python stdlib only."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request


PROFILE = Path(__file__).resolve().parent
ROOT = PROFILE.parents[2]
PORTS = {
    "DEVKIT_ADMIN_PORT": "10080",
    "DEVKIT_NODE_PORT": "13001",
    "DEVKIT_OGMIOS_PORT": "11337",
    "DEVKIT_KUPO_PORT": "11442",
    "DEVKIT_HISTORY_PORT": "18081",
    "DEVKIT_HISTORY_DB_PORT": "15432",
}
DEFAULTS = {**PORTS, "DEVKIT_HOST": "127.0.0.1"}


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
        self.settings = validate_settings(settings)

    def compose(self, *args, capture=False):
        # Explicit file and project selection also protect stop/reset from ambient
        # COMPOSE_FILE / COMPOSE_PROJECT_NAME values in the caller's shell.
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("COMPOSE_") and key not in DEFAULTS}
        env.update(self.settings)
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

    def ogmios(self, method, params=None):
        response = subprocess.run(
            ["node", str(PROFILE / "ogmios.mjs"), self.endpoint("DEVKIT_OGMIOS_PORT"), method],
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
        values = {
            "CARDANO_CHAIN_ID": "cardano-devkit",
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
        }
        write_env(self.state / "endpoints.env", values)

    def start(self):
        started = time.monotonic()
        profile_hash = hashlib.sha256(b"".join(
            path.read_bytes() for path in (
                PROFILE / "Dockerfile", PROFILE / "compose.yaml", PROFILE / "node.properties",
                PROFILE / "entrypoint.sh", PROFILE.parent / "yaci/config/application.properties",
            )
        )).hexdigest()
        marker = self.state / "profile.sha256"
        if marker.exists() and marker.read_text() != profile_hash:
            raise RuntimeError("DevKit configuration changed, run `caribic devkit reset` to recreate its data")
        marker.write_text(profile_hash)
        write_env(self.settings_path, self.settings)
        self.compose("up", "-d", "--build", "devkit")
        admin = self.endpoint("DEVKIT_ADMIN_PORT") + "/local-cluster/api/admin/devnet"
        wait_for("DevKit genesis", lambda: http(admin + "/genesis/shelley"))
        wait_for("Ogmios block production", lambda: block_production_ready(self.endpoint("DEVKIT_OGMIOS_PORT")))
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
        wait_for("Yaci history", lambda:
                 http(self.endpoint("DEVKIT_HISTORY_PORT") + "/api/v1/blocks/latest").get("epoch", 0) >= 1)
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
        print("Experimental single-producer profile. Full IBC workflows still require `caribic start`.")

    def resources(self):
        ids = self.compose("ps", "-q", capture=True).split()
        if not ids:
            return []
        result = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}", *ids],
                                text=True, capture_output=True, check=True)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def stop(self):
        self.compose("down", "--remove-orphans")

    def reset(self):
        settings = validate_settings({**DEFAULTS, **read_settings(PROFILE / ".env"),
                                      **{key: os.environ[key] for key in DEFAULTS if key in os.environ}})
        self.compose("down", "--volumes", "--remove-orphans")
        for name in ("runtime.env", "endpoints.env", "startup.json", "genesis.json", "test.json", "profile.sha256"):
            (self.state / name).unlink(missing_ok=True)
        self.settings = settings
        self.start()

    def status(self):
        self.compose("ps", "--all")
        print(f"Endpoints: {self.state / 'endpoints.env'}")
        print("Full bridge workflow: unsupported by this single-producer profile.")
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
    parser.add_argument("action", choices=("start", "stop", "reset", "status", "test"))
    args = parser.parse_args()
    runtime = Runtime()
    with (runtime.state / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another DevKit command is running in this checkout")
        getattr(runtime, args.action)()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"DevKit: {error}", file=sys.stderr)
        sys.exit(1)
