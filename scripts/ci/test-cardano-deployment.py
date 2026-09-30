#!/usr/bin/env python3
"""Run the production deployment on an isolated, freshly clocked Cardano devnet.

Requires Docker Compose, Deno, and a silent production cardano/onchain/plutus.json.
Creates a unique Yaci DevKit project through the same provisioner as Caribic.
No unrelated containers or volumes are stopped or changed.
Artifacts (including logs, live inventory, and protocol parameters) remain in the
runtime directory. Add --cleanup to remove this harness's own containers/volumes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import socket
import sys

ROOT = Path(__file__).resolve().parents[2]
OFFCHAIN = ROOT / "cardano/offchain"
sys.path.insert(0, str(ROOT / "chains/cardano/devkit"))
from profile import Runtime, validate_settings
LIMITS = {"maxTxSize": 16384, "memory": 16500000, "steps": 10000000000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker-context")
    parser.add_argument("--runtime-root", type=Path, default=ROOT / ".deployment-smoke")
    parser.add_argument("--ogmios-port", type=int, default=2337)
    parser.add_argument("--kupo-port", type=int, default=2442)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if not (ROOT / "cardano/onchain/plutus.json").is_file():
        parser.error("Build production validators with aiken build --trace-level silent first")
    args.runtime_root.mkdir(parents=True, exist_ok=True)
    runtime_root = Path(tempfile.mkdtemp(prefix="devkit-", dir=args.runtime_root.resolve()))

    def run(command, **kwargs):
        return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

    if args.docker_context:
        os.environ["DOCKER_HOST"] = run([
            "docker", "context", "inspect", args.docker_context,
            "--format", "{{.Endpoints.docker.Host}}",
        ])
        os.environ.pop("DOCKER_CONTEXT", None)
    runtime = Runtime(root=runtime_root)
    # Reserve distinct host ports while assigning this isolated project's settings.
    reservations = []
    try:
        for key in runtime.settings:
            if key.endswith("_PORT"):
                reservation = socket.socket()
                port = args.ogmios_port if key == "DEVKIT_OGMIOS_PORT" else (
                    args.kupo_port if key == "DEVKIT_KUPO_PORT" else 0)
                reservation.bind(("127.0.0.1", port))
                reservations.append(reservation)
                runtime.settings[key] = str(reservation.getsockname()[1])
        runtime.settings["DEVKIT_HOST"] = "127.0.0.1"
        validate_settings(runtime.settings)
    finally:
        for reservation in reservations:
            reservation.close()
    project = runtime.project
    cli = runtime.cli

    def get_json(url):
        with urllib.request.urlopen(url, timeout=10) as response:
            return json.load(response)

    def wait_for(description, predicate, timeout=180):
        deadline = time.monotonic() + timeout
        last_error = None
        while time.monotonic() < deadline:
            try:
                value = predicate()
                if value:
                    return value
            except Exception as error:
                last_error = error
            time.sleep(2)
        raise RuntimeError(f"Timed out waiting for {description}: {last_error}")

    print(f"Isolated project: {project}; artifacts: {runtime_root}", flush=True)
    try:
        runtime.start()
        ogmios = runtime.endpoint("DEVKIT_OGMIOS_PORT")
        kupo = runtime.endpoint("DEVKIT_KUPO_PORT")
        parameters = json.loads(cli("conway", "query", "protocol-parameters", "--testnet-magic", "42"))
        (runtime_root / "protocol-parameters.json").write_text(json.dumps(parameters, indent=2) + "\n")
        if parameters["protocolVersion"]["major"] < 10:
            raise RuntimeError("Deployment validators use Plutus V3 byte-string builtins requiring protocol version 10 or later")
        actual_limits = {"maxTxSize": parameters["maxTxSize"], **parameters["maxTxExecutionUnits"]}
        if actual_limits != LIMITS:
            raise RuntimeError(f"Devnet limits must be production limits: {actual_limits}")
        # The checked-in default is a public local-devnet key. Never print it or
        # put it in command arguments; the child reads it from its environment.
        env = dict(os.environ)
        for line in (OFFCHAIN / ".env.default").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env[key] = value.strip().strip('"')
        for key in ["KUPO_API_KEY", "OGMIOS_API_KEY"]:
            env.pop(key, None)
        env["IBC_DEPLOYMENT_MODE"] = "legacy"
        env.pop("MIGRATION_GOVERNANCE_FILE", None)
        inventory_path = runtime_root / "deployment-plan.json"
        cost_path = runtime_root / "deployment-cost-report.json"
        env.update({"KUPO_URL": kupo, "OGMIOS_URL": ogmios, "CARDANO_NETWORK_MAGIC": "42", "DEPLOYMENT_PLAN_OUTPUT": str(inventory_path), "DEPLOYMENT_COST_REPORT_PATH": str(cost_path)})
        address_output = run([
            "deno", "run", "--config", str(OFFCHAIN / "deno.json"),
            "--allow-net", "--allow-env", "--allow-read", "--allow-run", "--allow-ffi",
            str(OFFCHAIN / "scripts/get-wallet-address.ts"),
        ], cwd=runtime_root, env=env)
        wallet = json.loads(address_output)["address"]
        runtime.fund(wallet, 100_000_000_000)
        wait_for("deployer funding", lambda: sum(
            output["value"]["coins"] for output in get_json(kupo + "/matches/" + wallet + "?unspent")
        ) >= 100_000_000_000)
        # Pin the exact blueprint for the whole run, even if a developer builds
        # another candidate while this network confirms its transactions.
        blueprint_path = ROOT / "cardano/onchain/plutus.json"
        blueprint_bytes = blueprint_path.read_bytes()
        blueprint_sha256 = hashlib.sha256(blueprint_bytes).hexdigest()
        blueprint_snapshot = runtime_root / "plutus.json"
        blueprint_snapshot.write_bytes(blueprint_bytes)
        import_map = {"imports": json.loads((OFFCHAIN / "deno.json").read_text())["imports"]}
        import_map["imports"][blueprint_path.as_uri()] = blueprint_snapshot.as_uri()
        import_map_path = runtime_root / "import-map.json"
        import_map_path.write_text(json.dumps(import_map, indent=2) + "\n")
        log_path = runtime_root / "deployment.log"
        print(f"Running production deployment; log: {log_path}", flush=True)
        with log_path.open("w") as log:
            subprocess.run(["deno", "run", "--config", str(OFFCHAIN / "deno.json"), "--import-map", str(import_map_path), "--allow-net", "--allow-env", "--allow-read", "--allow-run", "--allow-ffi", "--allow-write", str(OFFCHAIN / "index.ts")], cwd=runtime_root, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        manifest = runtime_root / "deployments/handler.json"
        shutil.copy2(manifest, runtime_root / "handler.json")
        plan = json.loads(inventory_path.read_text())
        expected = {validator["hash"] for validator in plan["referenceValidators"]}
        holder = next(validator["address"] for validator in plan["inlineValidators"] if validator["title"] == "reference_validator.refer_only.else")
        def complete_reference_inventory():
            published = get_json(kupo + "/matches/" + holder + "?unspent")
            observed = {output["script_hash"] for output in published if output.get("script_hash")}
            return published if observed == expected else None
        wait_for("all planned reference publications in Kupo", complete_reference_inventory)
        report = json.loads(cost_path.read_text())
        transactions = report["transactions"]
        if any(tx["signedSizeBytes"] > LIMITS["maxTxSize"] for tx in transactions):
            raise RuntimeError("Deployment report contains an oversized signed transaction")
        result = {"project": project, "blueprintSha256": blueprint_sha256, "protocolVersion": parameters["protocolVersion"], "limits": actual_limits, "references": len(expected), "transactions": len(transactions), "largestSignedTransactionBytes": max(tx["signedSizeBytes"] for tx in transactions)}
        (runtime_root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2), flush=True)
    finally:
        if args.cleanup:
            runtime.compose("down", "--volumes")
        else:
            print(f"Preserved isolated project {project} and artifacts {runtime_root}", flush=True)


if __name__ == "__main__":
    main()
