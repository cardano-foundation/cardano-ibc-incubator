"""Prepare genesis producers using the key scripts shipped with Yaci DevKit."""

import io
import json
from pathlib import Path
import shutil
import subprocess
import zipfile


def cli(*args):
    return subprocess.check_output(["cardano-cli", *args], text=True).strip()


def prepare(directory=Path("/bootstrap")):
    if (directory / "pools.json").exists():
        for index in range(2, 6):
            for name in ("cold.vkey", "cold.skey", "vrf.skey", "kes.skey", "opcert.cert"):
                if not (directory / f"producer-{index}" / name).is_file():
                    raise ValueError("Saved DevKit pool keys are incomplete, reset the network")
        return
    with zipfile.ZipFile("/app/yaci-cli.jar") as jar:
        archive = zipfile.ZipFile(io.BytesIO(jar.read("BOOT-INF/classes/localcluster.zip")))
    scripts = {}
    for name in ("gen-pool-keys.sh", "gen-pool-cert.sh"):
        source = archive.read("localcluster/templates/devnet/" + name).decode()
        scripts[name] = source.replace("${BIN_FOLDER}", "/app/cardano-bin").replace("${protocolMagic}", "42")
    pools = []
    for index in range(2, 6):
        folder = directory / f"producer-{index}"
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True, mode=0o700)
        for name, source in scripts.items():
            path = folder / name
            path.write_text(source)
            subprocess.run(["sh", str(path), *(["0"] if name == "gen-pool-cert.sh" else [])],
                           cwd=folder, check=True)
            path.unlink()
        pools.append({
            "pool": cli("stake-pool", "id", "--cold-verification-key-file", str(folder / "cold.vkey"),
                        "--output-format", "hex"),
            "vrf": cli("node", "key-hash-VRF", "--verification-key-file", str(folder / "vrf.vkey")),
            "stake": cli("stake-address", "key-hash", "--stake-verification-key-file", str(folder / "stake.vkey")),
            "address": json.loads(cli("address", "info", "--address", (folder / "payment.addr").read_text().strip()))["base16"],
        })
    temporary = directory / "pools.tmp"
    temporary.write_text(json.dumps(pools))
    temporary.replace(directory / "pools.json")


def seed(genesis, pools):
    """Add funded, delegated producers before the network's first block."""
    existing = genesis["staking"]["pools"]
    if (len(existing) != 1 or len(pools) != 4
            or len(set(existing) | {pool["pool"] for pool in pools}) != 5
            or len({pool["stake"] for pool in pools}) != 4
            or len({pool["address"] for pool in pools}) != 4):
        raise ValueError("Expected one DevKit genesis pool and four distinct additional pools")
    for pool in pools:
        genesis["staking"]["pools"][pool["pool"]] = {
            "cost": 170_000_000, "margin": 0, "metadata": None, "owners": [], "pledge": 0,
            "publicKey": pool["pool"], "relays": [],
            "rewardAccount": {"credential": {"keyHash": pool["stake"]}, "network": "Testnet"},
            "vrf": pool["vrf"],
        }
        genesis["staking"]["stake"][pool["stake"]] = pool["pool"]
        genesis["initialFunds"][pool["address"]] = 300_000_000_000


if __name__ == "__main__":
    prepare()
