#!/usr/bin/env python3
"""Run the production deployment on an isolated, freshly clocked Cardano devnet.

Requires Docker Compose, Deno, and a silent production cardano/onchain/plutus.json.
Default creates a unique Compose project; --compose/--project reuses an explicitly
selected test project. No unrelated containers or volumes are stopped or changed.
Artifacts (including logs, live inventory, and protocol parameters) remain in the
runtime directory. Add --cleanup to remove this harness's own containers/volumes.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
OFFCHAIN = ROOT / "cardano/offchain"
LIMITS = {"maxTxSize": 16384, "memory": 16500000, "steps": 10000000000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker-context")
    parser.add_argument("--compose", type=Path)
    parser.add_argument("--project")
    parser.add_argument("--runtime-root", type=Path, default=ROOT / ".deployment-smoke")
    parser.add_argument("--ogmios-port", type=int, default=2337)
    parser.add_argument("--kupo-port", type=int, default=2442)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if bool(args.compose) != bool(args.project):
        parser.error("--compose and --project must be supplied together")
    if not (ROOT / "cardano/onchain/plutus.json").is_file():
        parser.error("Build production validators with aiken build --trace-level silent first")
    project = args.project or f"cardano-deployment-test-{uuid.uuid4().hex[:12]}"
    if not args.compose:
        args.runtime_root.mkdir(parents=True, exist_ok=True)
    runtime_root = args.compose.resolve().parent if args.compose else Path(tempfile.mkdtemp(prefix=project + "-", dir=args.runtime_root.resolve()))
    runtime = runtime_root / "runtime"
    compose_file = args.compose.resolve() if args.compose else runtime_root / "compose.json"
    docker = ["docker"] + (["--context", args.docker_context] if args.docker_context else [])
    compose = docker + ["compose", "-p", project, "-f", str(compose_file)]

    def run(command, **kwargs):
        return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

    def cli(*command):
        return run(compose + ["exec", "-T", "node", "cardano-cli", *command])

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

    if not args.compose:
        shutil.copytree(ROOT / "chains/cardano/config/devnet", runtime)
        shutil.copytree(ROOT / "chains/cardano/config/credentials", runtime / "credentials")
        for key_file in runtime.rglob("*"):
            if key_file.suffix in {".skey", ".sk", ".key"}:
                key_file.chmod(0o600)
        # Keep test credentials in their initial KES period while starting the
        # chain near the real clock. Transaction/ExUnit limits are unchanged.
        start = int(time.time()) - 30
        for name, updates in [
            ("genesis-byron.json", {"startTime": start}),
            ("genesis-shelley.json", {
                "systemStart": datetime.datetime.fromtimestamp(start, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "slotsPerKESPeriod": 31536000,
            }),
        ]:
            path = runtime / name
            data = json.loads(path.read_text())
            data.update(updates)
            path.write_text(json.dumps(data, indent=2) + "\n")
        shared = {"user": "0:0", "logging": {"driver": "json-file", "options": {"max-size": "2m", "max-file": "3"}}}
        compose_file.write_text(json.dumps({
            "services": {
                "node": {**shared, "image": "ghcr.io/blinklabs-io/cardano-node:10.1.4-3", "volumes": [f"{runtime}:/runtime", "socket:/socket", "node-db:/data"], "environment": {
                    "CARDANO_BLOCK_PRODUCER": "true", "CARDANO_CONFIG": "/runtime/cardano-node.json", "CARDANO_DATABASE_PATH": "/data/db", "CARDANO_BIND_ADDR": "0.0.0.0", "CARDANO_PORT": "3001", "CARDANO_TOPOLOGY": "/runtime/topology.json", "CARDANO_SOCKET_PATH": "/socket/node.socket", "CARDANO_NODE_SOCKET_PATH": "/socket/node.socket", "CARDANO_SHELLEY_KES_KEY": "/runtime/kes.skey", "CARDANO_SHELLEY_VRF_KEY": "/runtime/vrf.skey", "CARDANO_SHELLEY_OPERATIONAL_CERTIFICATE": "/runtime/opcert.cert", "RESTORE_SNAPSHOT": "false",
                }, "command": ["run"]},
                "ogmios": {**shared, "image": "cardanosolutions/ogmios:v6.12.0", "volumes": [f"{runtime}:/runtime", "socket:/socket"], "ports": [f"127.0.0.1:{args.ogmios_port}:1337"], "depends_on": ["node"], "restart": "on-failure", "command": ["--node-config", "/runtime/cardano-node.json", "--host", "0.0.0.0", "--node-socket", "/socket/node.socket"]},
                "kupo": {**shared, "image": "cardanosolutions/kupo:v2.9.0", "volumes": [f"{runtime}:/runtime", "socket:/socket", "kupo-db:/db"], "ports": [f"127.0.0.1:{args.kupo_port}:1442"], "depends_on": ["node"], "restart": "on-failure", "command": ["--node-socket", "/socket/node.socket", "--node-config", "/runtime/cardano-node.json", "--since", "origin", "--match", "*", "--workdir", "/db", "--host", "0.0.0.0", "--port", "1442"]},
            }, "volumes": {"socket": {}, "node-db": {}, "kupo-db": {}},
        }, indent=2) + "\n")

    print(f"Isolated project: {project}; artifacts: {runtime_root}", flush=True)
    try:
        run(compose + ["up", "-d"])
        # Bind observations to the selected project, including --compose reuse.
        ogmios_port = int(run(compose + ["port", "ogmios", "1337"]).splitlines()[0].rsplit(":", 1)[1])
        kupo_port = int(run(compose + ["port", "kupo", "1442"]).splitlines()[0].rsplit(":", 1)[1])
        ogmios = f"http://127.0.0.1:{ogmios_port}"
        kupo = f"http://127.0.0.1:{kupo_port}"
        wait_for("Conway node", lambda: get_json(ogmios + "/health").get("currentEra") == "conway")
        parameters = json.loads(cli("conway", "query", "protocol-parameters", "--testnet-magic", "42"))
        (runtime_root / "protocol-parameters.json").write_text(json.dumps(parameters, indent=2) + "\n")
        if parameters["protocolVersion"]["major"] < 10:
            raise RuntimeError("Deployment validators use Plutus V3 byte-string builtins requiring protocol version 10 or later")
        actual_limits = {"maxTxSize": parameters["maxTxSize"], **parameters["maxTxExecutionUnits"]}
        if actual_limits != LIMITS:
            raise RuntimeError(f"Devnet limits must be production limits: {actual_limits}")
        wallet = (runtime / "credentials/me.addr").read_text().strip()
        wallet_outputs = lambda: get_json(kupo + "/matches/" + wallet + "?unspent")
        wait_for("Kupo", lambda: get_json(kupo + "/matches/*?unspent") is not None)
        if sum(output["value"]["coins"] for output in wallet_outputs()) < 100_000_000_000:
            faucet = cli("address", "build", "--payment-verification-key-file", "/runtime/credentials/faucet.vk", "--testnet-magic", "42")
            faucet_utxos = json.loads(cli("conway", "query", "utxo", "--address", faucet, "--output-json", "--testnet-magic", "42"))
            txin = max(faucet_utxos, key=lambda ref: faucet_utxos[ref]["value"]["lovelace"])
            cli("conway", "transaction", "build", "--change-address", faucet, "--tx-in", txin, "--tx-out", wallet + "+100000000000", "--out-file", "/runtime/deployment-funding.body", "--testnet-magic", "42")
            cli("conway", "transaction", "sign", "--tx-body-file", "/runtime/deployment-funding.body", "--signing-key-file", "/runtime/credentials/faucet.sk", "--out-file", "/runtime/deployment-funding.signed", "--testnet-magic", "42")
            cli("conway", "transaction", "submit", "--tx-file", "/runtime/deployment-funding.signed", "--testnet-magic", "42")
            wait_for("deployer funding", lambda: sum(output["value"]["coins"] for output in wallet_outputs()) >= 100_000_000_000)
        # The checked-in default is a public local-devnet key. Never print it or
        # put it in command arguments; the child reads it from its environment.
        env = dict(os.environ)
        for line in (OFFCHAIN / ".env.default").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env[key] = value.strip().strip('"')
        for key in ["KUPO_API_KEY", "OGMIOS_API_KEY"]:
            env.pop(key, None)
        inventory_path = runtime_root / "deployment-plan.json"
        cost_path = runtime_root / "deployment-cost-report.json"
        env.update({"KUPO_URL": kupo, "OGMIOS_URL": ogmios, "CARDANO_NETWORK_MAGIC": "42", "DEPLOYMENT_PLAN_OUTPUT": str(inventory_path), "DEPLOYMENT_COST_REPORT_PATH": str(cost_path)})
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
            run(compose + ["down", "--volumes"])
        else:
            print(f"Preserved isolated project {project} and artifacts {runtime_root}", flush=True)


if __name__ == "__main__":
    main()
