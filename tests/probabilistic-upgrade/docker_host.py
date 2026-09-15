#!/usr/bin/env python3
"""Local lifecycle/CLI adapter for run_light_client_upgrade.sh; never uses Compose."""

import json
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


def docker(*args, capture=False):
    return subprocess.run(["docker", *args], check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def inspect(name):
    return json.loads(docker("inspect", name, capture=True))[0]


def main():
    name = os.environ["UPGRADE_CONTAINER"]
    if not re.fullmatch(r"cardano-ibc-upgrade-[a-z0-9-]+", name):
        raise ValueError("UPGRADE_CONTAINER must start with cardano-ibc-upgrade- and use lowercase letters/digits/hyphens")
    state = Path(os.environ["UPGRADE_STATE_DIR"]).resolve()
    profile = os.environ.get("COSMOS_PROFILE", "v8-classic")
    if profile not in ("v8-classic", "v10-classic"):
        raise ValueError("Only Classic profiles are supported")
    action = sys.argv[1]

    def own_container():
        info = inspect(name)
        if info["Config"]["Labels"].get("org.cardano-ibc.upgrade-fixture") != str(state):
            raise ValueError("Refusing to control a container owned by another environment")
        return info

    def start(image, minimum_height=2):
        metadata = inspect(image)
        if metadata["Config"]["Labels"].get("org.cardano-ibc.profile") != profile:
            raise ValueError("Image profile differs from the fixture profile")
        # Require the manifest emitted by build_live_images.py before starting.
        json.loads(metadata["Config"]["Labels"]["org.cardano-ibc.upgrade-modules"])
        command = ["run", "-d", "--name", name,
                   "--label", "org.cardano-ibc.upgrade-fixture=" + str(state),
                   "--mount", f"type=bind,source={state},target=/var/lib/simd"]
        published_ports = {}
        for port, default, target in [("RPC", "27757", "26657"), ("GRPC", "9200", "9090"), ("REST", "1427", "1317")]:
            value = os.environ.get(f"UPGRADE_{port}_PORT", default)
            if not value.isdigit() or not 1024 <= int(value) <= 65535:
                raise ValueError("Expected an unprivileged numeric host port")
            command += ["-p", f"127.0.0.1:{value}:{target}"]
            published_ports[port] = int(value)
        environment = {
            "COSMOS_PROFILE": profile, "COSMOS_IBC_SEMANTICS": "classic",
            "COSMOS_CHAIN_ID": os.environ.get("COSMOS_CHAIN_ID", profile + "-1"),
            "COSMOS_MONIKER": name, "SIMD_HOME": "/var/lib/simd",
            "COSMOS_GENESIS_ACCOUNT_BALANCE": "100000000000stake,100000000000utest",
            "COSMOS_GENTX_AMOUNT": "500000000stake", "COSMOS_MINIMUM_GAS_PRICES": "0.0025stake",
            # A live client can initially trust block 1's genesis timestamp.
            # A fixed historical timestamp would make that client expire as
            # soon as the next host block advances to the present.
            "COSMOS_GENESIS_TIME": datetime.fromtimestamp(time.time() - 30, timezone.utc).isoformat().replace("+00:00", "Z"),
            # This restart scenario does not vote on proposals. Keep regular
            # voting longer than the SDK's default 24h expedited period.
            "COSMOS_GOV_VOTING_PERIOD": "48h",
            # Public deterministic local-test accounts, same as the profiles.
            "COSMOS_VALIDATOR_MNEMONIC": "bottom loan skill merry east cradle onion journey palm apology verb edit desert impose absurd oil bubble sweet glove shallow size build burst effort",
            "COSMOS_RELAYER_MNEMONIC": "sketch mountain erode window enact net enrich smoke claim kangaroo another visual write meat latin bacon pulp similar forum guilt father state erase bright",
            "COSMOS_DEMO_MNEMONIC": "mix around destroy web fever address comfort vendor tank sudden abstract cabin acoustic attitude peasant hospital vendor harsh void current shield couple barrel suspect",
        }
        for key, value in environment.items():
            command += ["-e", f"{key}={value}"]
        # Resolve a tag once. Run that exact image even if the tag moves later.
        docker(*command, metadata["Id"])
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            # Check the host-published endpoints used by Hermes. An in-container
            # health check can pass before Docker restores its port forwarding.
            try:
                with urlopen(f"http://127.0.0.1:{published_ports['RPC']}/status", timeout=2) as response:
                    status = json.load(response)["result"]
                if status["node_info"]["network"] != environment["COSMOS_CHAIN_ID"]:
                    raise RuntimeError("Running host has the wrong chain ID")
                if int(status["sync_info"]["latest_block_height"]) >= minimum_height:
                    with socket.create_connection(("127.0.0.1", published_ports["GRPC"]), timeout=2):
                        pass
                    return
            except (OSError, URLError):
                pass
            if not inspect(name)["State"]["Running"]:
                docker("logs", "--tail", "20", name)
                raise RuntimeError("Local host exited before becoming ready")
            time.sleep(1)
        raise RuntimeError("Local host did not become ready; inspect its container logs")

    if action == "start":
        # Neither an existing data home nor a container can be overwritten.
        existing = subprocess.run(["docker", "container", "inspect", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if existing.returncode == 0:
            raise ValueError("Fixture container already exists")
        state.mkdir(parents=True, exist_ok=False)
        start(os.environ["UPGRADE_BEFORE_IMAGE"])
    elif action == "upgrade":
        own_container()
        # Check the target image before stopping a healthy test host.
        inspect(os.environ["UPGRADE_AFTER_IMAGE"])
        status = json.loads(docker("exec", name, "curl", "-fsS", "http://127.0.0.1:26657/status", capture=True))
        before_height = int(status["result"]["sync_info"]["latest_block_height"])
        docker("stop", "--timeout", "30", name)
        docker("rm", name)
        # Querying a retained height is insufficient: require the replacement
        # application to commit a new block before checking its client stores.
        start(os.environ["UPGRADE_AFTER_IMAGE"], minimum_height=before_height + 1)
    elif action == "identity":
        info = own_container()
        image = inspect(info["Image"])
        digest = docker("exec", name, "sha256sum", "/usr/local/bin/simd", capture=True).split()[0]
        print(json.dumps({"binary_sha256": digest, "image_id": info["Image"],
                          "modules": json.loads(image["Config"]["Labels"]["org.cardano-ibc.upgrade-modules"])}))
    else:
        own_container()
        # Also serves as SIMD_BIN. Bound in-container execution as well as the
        # outer timeout, so a cancelled Docker CLI cannot leave a tx running.
        os.execvp("docker", ["docker", "exec", name, "timeout", "-s", "TERM", "-k", "5", "60", "simd", *sys.argv[1:]])


if __name__ == "__main__":
    main()
