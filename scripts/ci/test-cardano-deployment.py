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
import ipaddress
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

_reference_spec = importlib.util.spec_from_file_location("deployment_references", Path(__file__).with_name("deployment-references.py"))
_references = importlib.util.module_from_spec(_reference_spec)
_reference_spec.loader.exec_module(_references)
_clock_spec = importlib.util.spec_from_file_location("migration_clock_profile", Path(__file__).with_name("migration-clock-profile.py"))
_clock = importlib.util.module_from_spec(_clock_spec)
_clock_spec.loader.exec_module(_clock)

ROOT = Path(__file__).resolve().parents[2]
OFFCHAIN = ROOT / "cardano/offchain"
LIMITS = {"maxTxSize": 16384, "memory": 16500000, "steps": 10000000000}


def configure_relative_clock(node, runtime, offset):
    (runtime / "migration-clock.rc").write_text(f"{offset:+d}s\n")
    node["environment"]["CARDANO_LOCAL_CLOCK_FILE"] = "/runtime/migration-clock.rc"


def configure_migration_witness(node):
    node["ports"] = ["127.0.0.1:23001:3001"]


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
    parser.add_argument("--pool-count", type=int, choices=range(1, 6), default=1, help="Real forging pools; use five for counterparty stability verification")
    parser.add_argument("--clock-offset-seconds", type=int, default=0, help="Disposable devnet process-clock offset; never changes the host clock")
    parser.add_argument("--epoch-length", type=int, help="Fresh disposable genesis only; use 432000 for the two-day migration rehearsal")
    parser.add_argument("--host-data", action="store_true", help="Fresh runtime only: keep database volumes in its host data directory; sockets remain Linux volumes")
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
        start = int(time.time()) + args.clock_offset_seconds - 30
        for name, updates in [
            ("genesis-byron.json", {"startTime": start}),
            ("genesis-shelley.json", {
                "systemStart": datetime.datetime.fromtimestamp(start, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "slotsPerKESPeriod": 31536000,
                **({"epochLength": args.epoch_length} if args.epoch_length is not None else {}),
            }),
        ]:
            path = runtime / name
            data = json.loads(path.read_text())
            data.update(updates)
            path.write_text(json.dumps(data, indent=2) + "\n")
        if args.pool_count > 1:
            generator = project + "-pool-generator"
            generated = runtime_root / "generated-pools"
            generated.mkdir()
            supply = str(900_000_000_000 * (args.pool_count - 1))
            run(docker + ["create", "--name", generator, "--entrypoint", "cardano-cli", "ghcr.io/blinklabs-io/cardano-node:10.1.4-3",
                "latest", "genesis", "create-testnet-data", "--out-dir", "/out", "--pools", str(args.pool_count - 1),
                "--stake-delegators", str(args.pool_count - 1), "--testnet-magic", "42", "--total-supply", supply, "--delegated-supply", supply])
            try:
                run(docker + ["start", "--attach", generator])
                run(docker + ["cp", generator + ":/out/.", str(generated)])
            finally:
                run(docker + ["rm", "--force", generator])
            genesis_path = runtime / "genesis-shelley.json"
            genesis = json.loads(genesis_path.read_text())
            added = json.loads((generated / "shelley-genesis.json").read_text())
            for key in ["pools", "stake"]:
                genesis["staking"][key].update(added["staking"][key])
            genesis["initialFunds"].update(added["initialFunds"])
            genesis_path.write_text(json.dumps(genesis, indent=2) + "\n")
            for index in range(2, args.pool_count + 1):
                shutil.copytree(generated / "pools-keys" / f"pool{index - 1}", runtime / f"spo{index}")
            node_config_path = runtime / "cardano-node.json"
            node_config = json.loads(node_config_path.read_text())
            node_config["EnableP2P"] = False
            node_config_path.write_text(json.dumps(node_config, indent=2) + "\n")
            # Use literal addresses: the node's asynchronous DNS resolver and
            # a historical process clock do not share Docker DNS's time base.
            network_ids = run(docker + ["network", "ls", "-q"]).splitlines()
            allocated = json.loads(run(docker + ["network", "inspect", *network_ids])) if network_ids else []
            used = [ipaddress.ip_network(entry["Subnet"]) for network in allocated for entry in (network.get("IPAM") or {}).get("Config") or [] if entry.get("Subnet")]
            subnet = next(ipaddress.ip_network(f"10.231.{index}.0/24") for index in range(1, 255)
                          if not any(ipaddress.ip_network(f"10.231.{index}.0/24").overlaps(existing) for existing in used if existing.version == 4))
            for index in range(1, args.pool_count + 1):
                name = "node" if index == 1 else f"spo{index}"
                (runtime / f"topology-{name}.json").write_text(json.dumps({"Producers": [
                    {"addr": str(subnet.network_address + 100 + other), "port": 3001, "valency": 1}
                    for other in range(1, args.pool_count + 1) if other != index]}) + "\n")
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
        config = json.loads(compose_file.read_text())
        node = config["services"]["node"]
        if args.clock_offset_seconds:
            run(docker + ["build", "-t", "cardano-ibc-462-node-clock", "-f", str(ROOT / "chains/cardano/Dockerfile.local-clock"), str(ROOT / "chains/cardano")])
            node["image"] = "cardano-ibc-462-node-clock"
            # A fixed target rewinds time every time a container restarts. A
            # persistent relative offset keeps all producers on the same clock.
            configure_relative_clock(node, runtime, args.clock_offset_seconds)
        if args.pool_count > 1:
            config["networks"] = {"default": {"ipam": {"config": [{"subnet": str(subnet)}]}}}
            node["networks"] = {"default": {"ipv4_address": str(subnet.network_address + 101)}}
            node["environment"]["CARDANO_TOPOLOGY"] = "/runtime/topology-node.json"
            for index in range(2, args.pool_count + 1):
                name = f"spo{index}"
                extra = json.loads(json.dumps(node))
                extra["volumes"] = [f"{runtime}:/runtime", f"{name}-socket:/socket", f"{name}-db:/data"]
                extra["networks"] = {"default": {"ipv4_address": str(subnet.network_address + 100 + index)}}
                extra["environment"].update({"CARDANO_TOPOLOGY": f"/runtime/topology-{name}.json",
                    "CARDANO_SHELLEY_KES_KEY": f"/runtime/{name}/kes.skey", "CARDANO_SHELLEY_VRF_KEY": f"/runtime/{name}/vrf.skey",
                    "CARDANO_SHELLEY_OPERATIONAL_CERTIFICATE": f"/runtime/{name}/opcert.cert"})
                config["services"][name] = extra
                config["volumes"].update({f"{name}-socket": {}, f"{name}-db": {}})
        env["IBC_DEPLOYMENT_MODE"] = "upgradeable" if args.migration_baseline else "legacy"
        if args.migration_baseline:
            # Configure before deployment; service augmentation must not recreate
            # the node that has just confirmed the publication transactions.
            configure_migration_witness(node)
        if args.host_data:
            data_root = runtime_root / 'data'
            data_root.mkdir(mode=0o700)
            config['x-migration-host-data'] = str(data_root)
            for name in config['volumes']:
                if name.endswith('-db'):
                    directory = data_root / name
                    directory.mkdir(mode=0o700)
                    config['volumes'][name] = {'driver': 'local', 'driver_opts': {
                        'type': 'none', 'o': 'bind', 'device': str(directory)}}
        compose_file.write_text(json.dumps(config, indent=2) + "\n")

    if args.migration_baseline:
        # Fail before starting/funding a chain that the actual counterparty
        # cannot authenticate, even after arbitrarily many descendants.
        _clock.require_qualified_genesis(json.loads((runtime / 'genesis-shelley.json').read_text()))
    print(f"Isolated project: {project}; artifacts: {artifacts}", flush=True)
    try:
        if not args.existing_network:
            run(compose + ["up", "-d"])
        # Bind observations to the selected project, including --compose reuse.
        ogmios_port = int(run(compose + ["port", "ogmios", "1337"]).splitlines()[0].rsplit(":", 1)[1])
        kupo_port = int(run(compose + ["port", "kupo", "1442"]).splitlines()[0].rsplit(":", 1)[1])
        ogmios = f"http://127.0.0.1:{ogmios_port}"
        kupo = f"http://127.0.0.1:{kupo_port}"
        wait_for("Conway node", lambda: get_json(ogmios + "/health").get("currentEra") == "conway")
        if args.pool_count > 1:
            def pools_share_chain():
                tips = [json.loads(run(compose + ["exec", "-T", name, "cardano-cli", "conway", "query", "tip", "--testnet-magic", "42"]))
                        for name in ["node", *[f"spo{i}" for i in range(2, args.pool_count + 1)]]]
                return all(tip.get("block", 0) >= 2 for tip in tips) and len({tip.get("hash") for tip in tips}) == 1
            wait_for("all forging pools on the same canonical chain", pools_share_chain, timeout=300)
        parameters = json.loads(cli("conway", "query", "protocol-parameters", "--testnet-magic", "42"))
        (artifacts / "protocol-parameters.json").write_text(json.dumps(parameters, indent=2) + "\n")
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
            # Signed public transaction bytes are evidence, never signing keys.
            # cardano-cli writes this as container-root mode 0600 on Linux.
            # Read this public envelope through the owned container; never
            # relax permissions on signing keys or the credentials directory.
            (artifacts / 'funding-transaction.json').write_text(
                run(compose + ['exec', '-T', 'node', 'cat', '/runtime/deployment-funding.signed']) + '\n')
            funding_hash = cli("conway", "transaction", "txid", "--tx-file", "/runtime/deployment-funding.signed")
            print(f"Submitting disposable faucet funding {funding_hash}", flush=True)
            cli("conway", "transaction", "submit", "--tx-file", "/runtime/deployment-funding.signed", "--testnet-magic", "42")
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
        # The checked-in default is a public local-devnet key. Never print it or
        # put it in command arguments; the child reads it from its environment.
        env = dict(os.environ)
        for line in (OFFCHAIN / ".env.default").read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env[key] = value.strip().strip('"')
        for key in ["KUPO_API_KEY", "OGMIOS_API_KEY"]:
            env.pop(key, None)
        inventory_path = artifacts / "deployment-plan.json"
        cost_path = artifacts / "deployment-cost-report.json"
        env.update({"KUPO_URL": kupo, "OGMIOS_URL": ogmios, "CARDANO_NETWORK_MAGIC": "42", "DEPLOYMENT_PLAN_OUTPUT": str(inventory_path), "DEPLOYMENT_COST_REPORT_PATH": str(cost_path)})
        if args.migration_baseline:
            address_info = json.loads(cli("address", "info", "--address", wallet))
            address_bytes = bytes.fromhex(address_info["base16"])
            if address_bytes[0] >> 4 not in {0, 2, 6}:
                raise RuntimeError("Isolated migration authority must be an explicit payment key address")
            authority = address_bytes[1:29].hex()
            governance_path = artifacts / "migration-governance.json"
            governance_path.write_text(json.dumps({"signers": [authority], "quorum": "1", "delay_ms": "86400000"}) + "\n")
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
        for service in ['node', *[f'spo{i}' for i in range(2, args.pool_count + 1)]]:
            commands['tip-' + service] = compose + ['exec', '-T', service, 'cardano-cli', 'conway', 'query', 'tip', '--testnet-magic', '42']
        if 'wallet' in locals():
            commands['wallet-ledger'] = compose + ['exec', '-T', 'node', 'cardano-cli', 'conway', 'query', 'utxo', '--address', wallet, '--output-json', '--testnet-magic', '42']
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
            logs = subprocess.run(compose + ['logs', '--no-color', '--tail', '3000', 'node', 'ogmios', 'kupo',
                *[f'spo{i}' for i in range(2, args.pool_count + 1)]], capture_output=True, text=True, timeout=30)
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
