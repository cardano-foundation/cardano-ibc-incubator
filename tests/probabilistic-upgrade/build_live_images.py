#!/usr/bin/env python3
"""Build distinct simd executables using the same immutable released client source."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--major", choices=["8", "10"], required=True)
    parser.add_argument("--image-prefix", required=True, help="Local image prefix; produces :before and :after")
    args = parser.parse_args()
    pins = json.loads((HERE / "releases.json").read_text())
    for module, version in [
        ("cardano-probabilistic-light-client-core", pins["core"]),
        ("cardano-probabilistic-light-client-v" + args.major, pins["adapters"][args.major]),
    ]:
        commit = subprocess.check_output(
            ["git", "rev-parse", f"refs/tags/cosmos/{module}/{version}^{{}}"], cwd=ROOT, text=True).strip()
        if commit != pins["commit"]:
            raise RuntimeError(f"Release tag for {module} does not match the pinned commit")
    profile = f"v{args.major}-classic"
    ibc_version, ibc_commit = {
        "8": ("8.7.0", "53eaba19375dab0145509af101dbce193284ec5d"),
        "10": ("10.2.0", "e120ef5d4778c3e659ce57b59f028b250be5bb2e"),
    }[args.major]
    modules = {
        "adapter": {"version": pins["adapters"][args.major], "commit": pins["commit"]},
        "core": {"version": pins["core"], "commit": pins["commit"]},
    }
    with tempfile.TemporaryDirectory(prefix="upgrade-image-") as tmp:
        work = Path(tmp)
        archive = work / "release.tar"
        subprocess.run(["git", "archive", "--format=tar", f"--output={archive}", pins["commit"],
                        "cosmos/cardano-probabilistic-light-client-core",
                        "cosmos/cardano-probabilistic-light-client-v8",
                        "cosmos/cardano-probabilistic-light-client-v10"], cwd=ROOT, check=True)
        subprocess.run(["tar", "-xf", str(archive)], cwd=work, check=True)
        archive.unlink()
        shutil.copytree(ROOT / "chains/cosmos", work / "chains/cosmos")
        for revision in ["before", "after"]:
            command = ["docker", "build", "-f", str(work / "chains/cosmos/Dockerfile"),
                       "-t", args.image_prefix + ":" + revision,
                       "--label", "org.cardano-ibc.upgrade-modules=" + json.dumps(modules, separators=(",", ":"))]
            for key, value in {
                # Match the v10 simapp's supported toolchain: its Sonic
                # dependency predates Go 1.25 runtime internals.
                "GO_IMAGE": "golang:1.25.13-alpine" if args.major == "8" else "golang:1.23.8-alpine", "PROFILE": profile,
                "IBC_GO_MAJOR": args.major, "IBC_GO_VERSION": ibc_version,
                "IBC_GO_REF": "v" + ibc_version, "IBC_GO_COMMIT": ibc_commit,
                "IBC_SEMANTICS": "classic", "HOST_BUILD_VERSION": "upgrade-fixture-" + revision,
            }.items():
                command += ["--build-arg", f"{key}={value}"]
            subprocess.run(command + [str(work)], check=True)


if __name__ == "__main__":
    main()
