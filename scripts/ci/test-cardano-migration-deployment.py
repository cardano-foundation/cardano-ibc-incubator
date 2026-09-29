#!/usr/bin/env python3
"""Run the production deployment on an isolated, freshly clocked Cardano devnet.

Requires Docker Compose, Deno, and a silent production cardano/onchain/plutus.json.
Default creates a unique Compose project; --compose/--project reuses an explicitly
selected test project. No unrelated containers or volumes are stopped or changed.
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
import uuid
import importlib.util

_reference_spec = importlib.util.spec_from_file_location("deployment_references", Path(__file__).parent / "aiken-contract-migration/deployment-references.py")
_references = importlib.util.module_from_spec(_reference_spec)
_reference_spec.loader.exec_module(_references)
_clock_spec = importlib.util.spec_from_file_location("migration_clock_profile", Path(__file__).parent / "aiken-contract-migration/migration-clock-profile.py")
_clock = importlib.util.module_from_spec(_clock_spec)
_clock_spec.loader.exec_module(_clock)

ROOT = Path(__file__).resolve().parents[2]
OFFCHAIN = ROOT / "cardano/offchain"
LIMITS = {"maxTxSize": 16384, "memory": 16500000, "steps": 10000000000}


_devkit_spec = importlib.util.spec_from_file_location("migration_devkit", ROOT / "scripts/ci/aiken-contract-migration/migration-devkit.py")
_devkit = importlib.util.module_from_spec(_devkit_spec)
_devkit_spec.loader.exec_module(_devkit)
configure_relative_clock = _devkit.configure_relative_clock


def confirmed_wallet_funding(wallet, indexed, ledger, minimum=100_000_000_000):
    indexed_refs = {f"{u['transaction_id']}#{u['output_index']}": u for u in indexed}
    if len(indexed_refs) != len(indexed):
        raise ValueError('Duplicate indexed funding outref')
    confirmed = 0
    for key, found in indexed_refs.items():
        actual = ledger.get(key)
        if found.get('spent_at') is not None or found['address'] != wallet:
            raise ValueError('Invalid indexed funding custody')
        if actual and actual['address'] == wallet and actual['value']['lovelace'] == found['value']['coins']:
            confirmed += actual['value']['lovelace']
    return confirmed >= minimum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker-context")
    parser.add_argument("--compose", type=Path)
    parser.add_argument("--project")
    parser.add_argument("--artifacts-dir", type=Path, help="New empty directory for a distinct baseline on an existing test network; never overwrites the earlier deployment")
    parser.add_argument("--blueprint", type=Path, default=ROOT / "cardano/onchain/plutus.json")
    parser.add_argument("--existing-network", action="store_true", help="Inspect/use an already running --compose project without recreating services")
    parser.add_argument("--runtime-root", type=Path, default=ROOT / ".deployment-smoke")
    parser.add_argument("--ogmios-port", type=int, default=2337)
    parser.add_argument("--kupo-port", type=int, default=2442)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--migration-baseline", action="store_true", help="Explicitly authorize this isolated test wallet as the upgrade-baseline authority")
    parser.add_argument("--pool-count", type=int, choices=[5], default=5, help="Real forging pools; use five for counterparty stability verification")
    parser.add_argument("--clock-offset-seconds", type=int, default=0, help="Disposable devnet process-clock offset; never changes the host clock")
    parser.add_argument("--epoch-length", type=int, help="Fresh disposable genesis only; use 432000 for the two-day migration rehearsal")
    parser.add_argument("--host-data", action="store_true", help="Fresh runtime only: keep database volumes in its host data directory; requires a Linux filesystem for node sockets")
    parser.add_argument("--through-funding", action="store_true", help="Diagnostic rehearsal only: stop after confirming disposable deployer funding; do not deploy a bridge")
    args = parser.parse_args()
    if bool(args.compose) != bool(args.project):
        parser.error("--compose and --project must be supplied together")
    if args.existing_network and not args.compose:
        parser.error("--existing-network requires an explicit --compose and --project")
    if args.compose and (args.epoch_length is not None or args.host_data):
        parser.error("Genesis timing/storage options cannot modify an existing fixture")
    if args.epoch_length is not None and not 5000 <= args.epoch_length <= 432000:
        parser.error("Fresh rehearsal epoch length must be between 5000 and 432000 one-second slots")
    if not args.blueprint.is_file():
        parser.error("Build production validators with aiken build --trace-level silent first")
    project = args.project or f"cardano-deployment-test-{uuid.uuid4().hex[:12]}"
    if not args.compose:
        args.runtime_root.mkdir(parents=True, exist_ok=True)
    runtime_root = args.compose.resolve().parent if args.compose else Path(tempfile.mkdtemp(prefix=project + "-", dir=args.runtime_root.resolve()))
    runtime = runtime_root / "runtime"
    compose_file = args.compose.resolve() if args.compose else runtime_root / "compose.json"
    artifacts = args.artifacts_dir.resolve() if args.artifacts_dir else runtime_root
    if args.artifacts_dir:
        if artifacts.exists() and any(artifacts.iterdir()):
            parser.error("--artifacts-dir must be empty; keep every previous baseline intact")
        artifacts.mkdir(parents=True, exist_ok=True)
    elif (artifacts / "handler.json").exists() or (artifacts / "deployment.log").exists():
        parser.error("This network already has deployment artifacts; select a fresh --artifacts-dir for a new baseline")
    docker = ["docker"] + (["--context", args.docker_context] if args.docker_context else [])
    compose = docker + ["compose", "-p", project, "-f", str(compose_file)]

    def run(command, **kwargs):
        return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

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

    if args.docker_context:
        os.environ["DOCKER_HOST"] = run(docker + ["context", "inspect", args.docker_context,
                                                "--format", "{{.Endpoints.docker.Host}}"])
        os.environ.pop("DOCKER_CONTEXT", None)
    devkit = _devkit.MigrationRuntime(runtime_root, project, args.clock_offset_seconds,
        args.epoch_length or 5000, args.ogmios_port, args.kupo_port,
        existing=bool(args.compose), host_data=args.host_data)
    cli = devkit.cli

    print(f"Isolated project: {project}; artifacts: {artifacts}", flush=True)
    try:
        if not args.existing_network:
            devkit.start()
        devkit.export_genesis()
        if args.migration_baseline:
            _clock.require_qualified_genesis(json.loads((runtime / "genesis-shelley.json").read_text()))
        # Bind observations to the selected project, including --compose reuse.
        ogmios_port = int(run(compose + ["port", "devkit", "1337"]).splitlines()[0].rsplit(":", 1)[1])
        kupo_port = int(run(compose + ["port", "devkit", "1442"]).splitlines()[0].rsplit(":", 1)[1])
        ogmios = f"http://127.0.0.1:{ogmios_port}"
        kupo = f"http://127.0.0.1:{kupo_port}"
        wait_for("Conway node", lambda: get_json(ogmios + "/health").get("currentEra") == "conway")
        if args.pool_count > 1:
            def pools_share_chain():
                tips = [json.loads(run(compose + ["exec", "-T", name, "cardano-cli", "conway", "query", "tip", "--testnet-magic", "42"]))
                        for name in _devkit.NODES]
                return all(tip.get("block", 0) >= 2 for tip in tips) and len({tip.get("hash") for tip in tips}) == 1
            wait_for("all forging pools on the same canonical chain", pools_share_chain, timeout=300)
        parameters = json.loads(cli("conway", "query", "protocol-parameters", "--testnet-magic", "42"))
        (artifacts / "protocol-parameters.json").write_text(json.dumps(parameters, indent=2) + "\n")
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
        env["IBC_DEPLOYMENT_MODE"] = "upgradeable" if args.migration_baseline else "legacy"
        inventory_path = artifacts / "deployment-plan.json"
        cost_path = artifacts / "deployment-cost-report.json"
        env.update({"KUPO_URL": kupo, "OGMIOS_URL": ogmios, "CARDANO_NETWORK_MAGIC": "42", "DEPLOYMENT_PLAN_OUTPUT": str(inventory_path), "DEPLOYMENT_COST_REPORT_PATH": str(cost_path)})
        address_output = run(["deno", "run", "--config", str(OFFCHAIN / "deno.json"),
            "--allow-net", "--allow-env", "--allow-read", "--allow-run", "--allow-ffi",
            str(OFFCHAIN / "scripts/get-wallet-address.ts")], cwd=artifacts, env=env)
        wallet = json.loads(address_output)["address"]
        devkit.fund(wallet, 100_000_000_000)
        wallet_outputs = lambda: get_json(kupo + "/matches/" + wallet + "?unspent")
        def canonical_funding():
            indexed = wallet_outputs()
            if sum(output['value']['coins'] for output in indexed) < 100_000_000_000:
                return None
            ledger = json.loads(cli('conway', 'query', 'utxo', '--address', wallet, '--output-json', '--testnet-magic', '42'))
            return {'indexed': indexed, 'ledger': ledger} if confirmed_wallet_funding(wallet, indexed, ledger) else None
        funding = wait_for('deployer funding in both the ledger and Kupo', canonical_funding)
        (artifacts / 'funding-confirmed.json').write_text(json.dumps({'project': project, 'wallet': wallet, **funding}) + '\n')
        if args.through_funding:
            (artifacts / 'funding-ready.json').write_text(json.dumps({'project': project, 'wallet': wallet,
                **funding,
                'scope': 'Disposable funding diagnostic; no bridge deployed'}) + '\n')
            return
        if args.migration_baseline:
            address_info = json.loads(cli("address", "info", "--address", wallet))
            address_bytes = bytes.fromhex(address_info["base16"])
            if address_bytes[0] >> 4 not in {0, 2, 6}:
                raise RuntimeError("Isolated migration authority must be an explicit payment key address")
            authority = address_bytes[1:29].hex()
            # Public BIP-39 fixture used only on this isolated magic-42 network.
            # Distinct from replacement authority and holder/executor fixtures.
            derive_emergency = "const {walletFromSeed,getAddressDetails}=require('@lucid-evolution/lucid');process.stdout.write(getAddressDetails(walletFromSeed('zoo '.repeat(11)+'wrong',{network:'Custom'}).address).paymentCredential.hash)"
            emergency = subprocess.check_output(['node', '-e', derive_emergency], cwd=ROOT / 'cardano/gateway', text=True).strip()
            governance_path = artifacts / "migration-governance.json"
            governance_path.write_text(json.dumps({"signers": [authority], "quorum": "1", "delay_ms": "86400000", "emergency":{"signers":[emergency],"quorum":"1"}}) + "\n")
            env["MIGRATION_GOVERNANCE_FILE"] = str(governance_path)
        else:
            env.pop("MIGRATION_GOVERNANCE_FILE", None)
        # Pin the exact blueprint for the whole run, even if a developer builds
        # another candidate while this network confirms its transactions.
        blueprint_path = ROOT / "cardano/onchain/plutus.json"
        blueprint_bytes = args.blueprint.resolve().read_bytes()
        blueprint_sha256 = hashlib.sha256(blueprint_bytes).hexdigest()
        blueprint_snapshot = artifacts / "plutus.json"
        blueprint_snapshot.write_bytes(blueprint_bytes)
        import_map = {"imports": json.loads((OFFCHAIN / "deno.json").read_text())["imports"]}
        import_map["imports"][blueprint_path.as_uri()] = blueprint_snapshot.as_uri()
        import_map_path = artifacts / "import-map.json"
        import_map_path.write_text(json.dumps(import_map, indent=2) + "\n")
        log_path = artifacts / "deployment.log"
        print(f"Running production deployment; log: {log_path}", flush=True)
        with log_path.open("w") as log:
            entry = OFFCHAIN / "index.ts"
            if args.clock_offset_seconds:
                entry = artifacts / "deployment-clock.ts"
                entry.write_text(f"// Disposable chain clock only; the production delay and scripts are unchanged.\nconst realNow = Date.now.bind(Date);\nDate.now = () => realNow() + {args.clock_offset_seconds * 1000};\nawait import({json.dumps((OFFCHAIN / 'index.ts').as_uri())});\n")
            subprocess.run(["deno", "run", "--config", str(OFFCHAIN / "deno.json"), "--import-map", str(import_map_path), "--allow-net", "--allow-env", "--allow-read", "--allow-run", "--allow-ffi", "--allow-write", str(entry)], cwd=artifacts, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        manifest = artifacts / "deployments/handler.json"
        shutil.copy2(manifest, artifacts / "handler.json")
        plan = json.loads(inventory_path.read_text())
        expected = {validator["hash"] for validator in plan["referenceValidators"]}
        holder = next(validator["address"] for validator in plan["inlineValidators"] if validator["title"] == "reference_validator.refer_only.else")
        def complete_reference_inventory():
            published = get_json(kupo + "/matches/" + holder + "?unspent")
            observed = {output["script_hash"] for output in published if output.get("script_hash")}
            return published if observed == expected else None
        wait_for("all planned reference publications in Kupo", complete_reference_inventory)
        _references.inspect_references(json.loads(manifest.read_text()), plan, compose, kupo,
                                       artifacts / 'reference-preflight-deployed.json')
        report = json.loads(cost_path.read_text())
        transactions = report["transactions"]
        if any(tx["signedSizeBytes"] > LIMITS["maxTxSize"] for tx in transactions):
            raise RuntimeError("Deployment report contains an oversized signed transaction")
        result = {"project": project, "networkRuntime": str(runtime_root), "artifacts": str(artifacts), "blueprintSha256": blueprint_sha256, "protocolVersion": parameters["protocolVersion"], "limits": actual_limits, "references": len(expected), "transactions": len(transactions), "largestSignedTransactionBytes": max(tx["signedSizeBytes"] for tx in transactions), "poolCount": args.pool_count, "clockOffsetSeconds": args.clock_offset_seconds}
        (artifacts / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2), flush=True)
    except BaseException:
        # Record both ledger and indexer observations before the runner/project
        # disappears. No environment, private credentials or chain homes.
        observations = {}
        commands = {'containers': compose + ['ps', '--format', 'json']}
        for service in _devkit.NODES:
            commands['tip-' + service] = compose + ['exec', '-T', service, 'cardano-cli', 'conway', 'query', 'tip', '--testnet-magic', '42']
        if 'wallet' in locals():
            commands['wallet-ledger'] = compose + ['exec', '-T', 'devkit', 'cardano-cli', 'conway', 'query', 'utxo', '--address', wallet, '--output-json', '--testnet-magic', '42']
        for name, command in commands.items():
            try:
                result = subprocess.run(command, capture_output=True, text=True, timeout=15)
                observations[name] = {'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
            except Exception as error: observations[name] = {'error': str(error)}
        if 'kupo' in locals():
            for name, url in [('kupo-health', kupo + '/health'), ('ogmios-health', ogmios + '/health'),
                              *([('wallet-indexed', kupo + '/matches/' + wallet + '?unspent')] if 'wallet' in locals() else [])]:
                try: observations[name] = get_json(url)
                except Exception as error: observations[name] = {'error': str(error)}
        (artifacts / 'baseline-failure-observations.json').write_text(json.dumps(observations, indent=2) + '\n')
        try:
            logs = subprocess.run(compose + ['logs', '--no-color', '--tail', '3000', 'devkit',
                *_devkit.profile.PRODUCERS], capture_output=True, text=True, timeout=30)
            (artifacts / 'baseline-failure-services.log').write_text(logs.stdout + logs.stderr)
        except Exception:
            pass
        raise
    finally:
        if args.cleanup:
            run(compose + ["down", "--volumes"])
        else:
            print(f"Preserved isolated project {project} and artifacts {artifacts}", flush=True)


if __name__ == "__main__":
    main()
