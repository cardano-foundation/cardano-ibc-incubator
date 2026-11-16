#!/usr/bin/env python3
"""Build or reuse a Yano deployment fixture, then verify it in a new process.

The cache contains only disposable devnet state and a generated test wallet.
It is never used as the live database. Failed cache verification rebuilds the
fixture and still requires a successful cold restore before publishing it.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = 2


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cache_identity(distribution, root=ROOT):
    # Hash the compiled blueprint, not Aiken source comments or test changes.
    # Include transitive deployment inputs and the exact runtime/configuration.
    tracked = subprocess.check_output([
        "git", "ls-files", "-z", "cardano/offchain", "packages", "proto-types",
    ], cwd=root).decode().split("\0")
    paths = {root / name for name in tracked if name}
    paths.update([root / "cardano/onchain/plutus.json",
                  root / "scripts/ci/yano-deployment.ts",
                  root / "scripts/ci/yano-shutdown.ts",
                  root / "scripts/ci/yano_snapshot.py"])
    inputs = {str(p.relative_to(root)): digest(p) for p in sorted(paths) if p.is_file()}
    runtime = {str(p.relative_to(distribution)): digest(p)
               for p in sorted((distribution / "config").rglob("*")) if p.is_file()}
    runtime["yano"] = digest(distribution / "yano")
    identity = {"schema": SCHEMA, "inputs": inputs, "runtime": runtime,
                "platform": platform.system(), "architecture": platform.machine(),
                "deno": subprocess.check_output(["deno", "--version"], text=True).strip()}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return key, identity


def request(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def inventory(base, addresses):
    result = {}
    for address in addresses:
        rows = []
        for page in range(1, 1001):
            batch = request(base, f"/addresses/{address}/utxos?count=100&page={page}")
            rows.extend(batch)
            if len(batch) < 100:
                break
        else:
            raise RuntimeError("UTxO pagination did not terminate")
        result[address] = sorted(rows, key=lambda row: (row["tx_hash"], row["output_index"]))
    return result


def configure_genesis(work):
    timestamp = int(time.time()) * 1000
    if (work / "chainstate").exists():
        genesis = json.loads((work / "config/network/devnet/shelley-genesis.json").read_text())
        timestamp = int(datetime.fromisoformat(genesis["systemStart"].replace("Z", "+00:00")).timestamp() * 1000)
    else:
        genesis_path = work / "config/network/devnet/shelley-genesis.json"
        genesis = json.loads(genesis_path.read_text())
        # The production shutdown builder uses a ten-minute validity window.
        # Keep it inside the devnet forecast horizon (200 ms slots).
        genesis["epochLength"] = max(genesis["epochLength"], 18000)
        genesis["systemStart"] = datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat().replace("+00:00", "Z")
        genesis_path.write_text(json.dumps(genesis, indent=2))
    return timestamp


@contextmanager
def node(distribution, work):
    http_port, peer_port = free_port(), free_port()
    while peer_port == http_port:
        peer_port = free_port()
    args = [str(distribution / "yano"), "-Dquarkus.profile=devnet",
            "-Dquarkus.http.host=127.0.0.1", f"-Dquarkus.http.port={http_port}",
            f"-Dyano.server.port={peer_port}", "-Dyano.block-producer.script-evaluator=scalus"]
    timestamp = configure_genesis(work)
    # Yano persists systemStart at whole-second precision. Pin that same
    # timestamp before startup so script evaluation and Lucid agree exactly.
    args.append(f"-Dyano.block-producer.genesis-timestamp={timestamp}")
    base = f"http://127.0.0.1:{http_port}/api/v1"
    with (work / "node.log").open("w") as log:
        process = subprocess.Popen(args, cwd=work, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"Yano exited during startup. See {work / 'node.log'}")
                try:
                    if request(base, "/node/tip").get("blockNumber", 0) > 0:
                        break
                except (OSError, ValueError):
                    pass
                if "YANO_STARTUP_FAILURE" in (work / "node.log").read_text():
                    raise RuntimeError(f"Yano startup failed. See {work / 'node.log'}")
                time.sleep(0.2)
            else:
                raise RuntimeError(f"Yano startup timed out. See {work / 'node.log'}")
            yield base
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def run_deployment(work, base, action, log_label=None):
    env = dict(os.environ, YANO_URL=base, YANO_ACTION=action,
               YANO_EVALUATION_ADAPTER="1", YANO_QUERY_ADAPTER="1", YANO_TIMED_SMOKE="1",
               YANO_GENESIS=str(work / "config/network/devnet/shelley-genesis.json"))
    # A CI fixture must not inherit operator credentials or output destinations.
    for name in list(env):
        if name.startswith(("DEPLOYER_", "DEPLOYMENT_", "MIGRATION_", "YACI_", "KUPO_", "OGMIOS_")):
            env.pop(name)
    with (work / f"{log_label or action}.log").open("w") as log:
        subprocess.run(["deno", "run", "--config", str(ROOT / "cardano/offchain/deno.json"),
                        "--frozen", "-A", str(ROOT / "scripts/ci/yano-deployment.ts")],
                       cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=300)


class IntegrationFailure(RuntimeError):
    """A test failure must fail CI, never be hidden by rebuilding the cache."""


def run_integration(work, base, label="integration"):
    try:
        run_deployment(work, base, "integration", label)
        result = json.loads((work / f"{label}.log").read_text().strip().splitlines()[-1])
        if result.get("passed") is not True:
            raise ValueError("Bridge integration suite did not pass")
        return result
    except Exception as error:
        raise IntegrationFailure(f"Bridge integration failed. See {work / (label + '.log')}") from error


def seal_fixture(fixture, key, identity):
    files = {str(p.relative_to(fixture)): digest(p) for p in sorted(fixture.rglob("*"))
             if p.is_file() and p.name != "manifest.json"}
    (fixture / "manifest.json").write_text(json.dumps({"key": key, "identity": identity, "files": files}, indent=2))


def validate_fixture(fixture, key):
    manifest = json.loads((fixture / "manifest.json").read_text())
    if manifest["key"] != key:
        raise ValueError("Snapshot inputs changed")
    observed = {str(p.relative_to(fixture)): digest(p) for p in fixture.rglob("*")
                if p.is_file() and p.name != "manifest.json"}
    if observed != manifest["files"]:
        raise ValueError("Snapshot file checksum mismatch")
    for name in ["checkpoint/CURRENT", "config/network/devnet/shelley-genesis.json",
                 "deployments/handler.json", "wallet.key", "inventory.json", "scripts.json", "provider-state.json"]:
        if not (fixture / name).is_file():
            raise ValueError(f"Incomplete snapshot: {name}")


def build_fixture(distribution, work, fixture, key, identity):
    work.mkdir()
    shutil.copytree(distribution / "config", work / "config")
    started = time.monotonic()
    with node(distribution, work) as base:
        run_deployment(work, base, "deploy")
        addresses = sorted(json.loads((work / "known-addresses.json").read_text()))
        expected = inventory(base, addresses)
        hashes = sorted({u["reference_script_hash"] for rows in expected.values() for u in rows if u.get("reference_script_hash")})
        if not hashes:
            raise RuntimeError("Deployment published no reference scripts")
        scripts = {h: request(base, f"/scripts/{h}/cbor") for h in hashes}
        request(base, "/devnet/snapshot", {"name": "ci-baseline"})
        fixture.mkdir()
        shutil.copytree(work / "snapshots/ci-baseline/checkpoint", fixture / "checkpoint")
        shutil.copytree(work / "config", fixture / "config")
        shutil.copytree(work / "deployments", fixture / "deployments")
        shutil.copy2(work / "wallet.key", fixture / "wallet.key")
        (fixture / "inventory.json").write_text(json.dumps(expected))
        (fixture / "scripts.json").write_text(json.dumps(scripts))
        shutil.copy2(work / "provider-state.json", fixture / "provider-state.json")
        seal_fixture(fixture, key, identity)
        ready_seconds = time.monotonic() - started
        integration = run_integration(work, base)
        (work / "integration-result.json").write_text(json.dumps(integration))
    return ready_seconds


def verify_fixture(distribution, fixture, work, key):
    validate_fixture(fixture, key)
    work.mkdir()
    started = time.monotonic()
    shutil.copytree(fixture / "checkpoint", work / "chainstate")
    shutil.copytree(fixture / "checkpoint", work / "snapshots/ci-baseline/checkpoint")
    shutil.copytree(fixture / "config", work / "config")
    shutil.copytree(fixture / "deployments", work / "deployments")
    shutil.copy2(fixture / "wallet.key", work / "wallet.key")
    shutil.copy2(fixture / "provider-state.json", work / "provider-state.json")
    expected = json.loads((fixture / "inventory.json").read_text())
    scripts = json.loads((fixture / "scripts.json").read_text())
    with node(distribution, work) as base:
        if inventory(base, expected) != expected:
            raise RuntimeError("Restored deployment UTxOs differ")
        if {h: request(base, f"/scripts/{h}/cbor") for h in scripts} != scripts:
            raise RuntimeError("Restored reference script bytes differ")
        ready_seconds = time.monotonic() - started
        run_deployment(work, base, "smoke")
        smoke = json.loads((work / "smoke.log").read_text().strip().splitlines()[-1])
        if smoke.get("scriptMintAdopted") is not True:
            raise RuntimeError("Restored script transaction failed")
        request(base, "/devnet/restore/ci-baseline", {})
        if inventory(base, expected) != expected:
            raise RuntimeError("Reset did not remove the script mint")
        integration = run_integration(work, base)
        request(base, "/devnet/restore/ci-baseline", {})
        if inventory(base, expected) != expected:
            raise IntegrationFailure("Reset did not restore the active bridge deployment")
        # Rerun against the reset state, not just the first cold restore.
        repeated = run_integration(work, base, "integration-reset")
    return {"integration": integration, "resetIntegration": repeated, "readySeconds": ready_seconds, "totalSeconds": time.monotonic() - started,
            "utxoCount": sum(map(len, expected.values())), "referenceScriptCount": len(scripts), "smoke": smoke}


def run(distribution, cache, output, force_fresh=False):
    output.mkdir(parents=True, exist_ok=False)
    key, identity = cache_identity(distribution)
    result = {"key": key, "cache": "miss", "saved": False}
    try:
        if cache.exists() and not force_fresh:
            try:
                result["verification"] = verify_fixture(distribution, cache, output / "cached-restore", key)
                result["cache"] = "hit"
                return result
            except IntegrationFailure:
                raise
            except Exception as error:
                result.update(cache="rebuild", cacheError=str(error))
                print(f"Cached fixture failed verification, rebuilding: {error}", flush=True)
        candidate = output / "fixture"
        result["freshSeconds"] = build_fixture(distribution, output / "fresh", candidate, key, identity)
        result["freshIntegration"] = json.loads((output / "fresh/integration-result.json").read_text())
        result["verification"] = verify_fixture(distribution, candidate, output / "fresh-restore", key)
        # Publish only a fixture that has passed a cold restore and bridge integration tests.
        if cache.exists():
            shutil.rmtree(cache)
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(candidate, cache)
        result["saved"] = True
        return result
    except Exception as error:
        result["error"] = str(error)
        raise
    finally:
        (output / "result.json").write_text(json.dumps(result, indent=2))
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
                stream.write(f"saved={str(result['saved']).lower()}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--print-key", action="store_true")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--force-fresh", action="store_true")
    args = parser.parse_args()
    distribution = args.distribution.resolve()
    if args.print_key:
        print(cache_identity(distribution)[0])
    else:
        if args.cache is None or args.output is None:
            parser.error("--cache and --output are required")
        cache, output = args.cache.resolve(), args.output.resolve()
        if cache == output or cache in output.parents or output in cache.parents:
            parser.error("Cache and output directories must be separate")
        print(json.dumps(run(distribution, cache, output, args.force_fresh), indent=2))


if __name__ == "__main__":
    main()
