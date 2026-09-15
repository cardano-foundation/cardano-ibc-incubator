#!/usr/bin/env python3
"""Build two external hosts against existing releases and retain the client DB."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
MODULE = "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/"


def run(args, cwd, env, *, capture=False):
    print("+ " + " ".join(map(str, args)), flush=True)
    return subprocess.run(args, cwd=cwd, env=env, text=True, check=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--major", choices=["8", "10"], required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="New evidence directory; must not already exist")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    pins = json.loads((HERE / "releases.json").read_text())
    env = dict(os.environ, GOWORK="off", GOTOOLCHAIN="go1.25.13", GOFLAGS="")
    with tempfile.TemporaryDirectory(prefix="probabilistic-upgrade-") as temp:
        work = Path(temp)
        adapter = MODULE + "cardano-probabilistic-light-client-v" + args.major
        core = MODULE + "cardano-probabilistic-light-client-core"
        (work / "go.mod").write_text(
            "module upgrade-fixture\n\ngo 1.25.13\n\nrequire (\n"
            f" {adapter} {pins['adapters'][args.major]}\n"
            f" {core} {pins['core']}\n)\n"
        )
        source = (HERE / "store_probe.go.tmpl").read_text()
        source = source.replace("@MAJOR@", args.major)
        source = source.replace("@PATH_IMPORT@", '' if args.major == "8" else
                                'commitmentv2 "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types/v2"')
        source = source.replace("@PATH_EXPRESSION@",
                                'commitmenttypes.NewMerklePath("ibc",string(key))' if args.major == "8" else
                                'commitmentv2.NewMerklePath([]byte("ibc"),key)')
        (work / "main.go").write_text(source)
        # Dependency go.mod replace directives are deliberately ignored by Go.
        # The consumer's graph must resolve the real core release from the proxy.
        origins = []
        for module, version in [(adapter, pins['adapters'][args.major]), (core, pins['core'])]:
            info = json.loads(run(["go", "mod", "download", "-json", module + "@" + version], work, env, capture=True))
            if info.get("Origin", {}).get("Hash") != pins["commit"]:
                raise RuntimeError(f"Unexpected immutable origin for {module}: {info.get('Origin')}")
            origins.append({k: info[k] for k in ("Path", "Version", "Sum", "GoModSum", "Origin")})
        run(["go", "mod", "tidy"], work, env)
        graph = run(["go", "list", "-m", "all"], work, env, capture=True)
        if "=>" in graph:
            raise RuntimeError("Release fixture must not contain local or fork replacements")
        (output / "modules.txt").write_text(graph)
        for file in ["go.mod", "go.sum"]:
            (output / file).write_bytes((work / file).read_bytes())
        binaries = {}
        for revision in ["before", "after"]:
            binary = work / revision
            run(["go", "build", "-mod=readonly", "-trimpath", "-ldflags", f"-X main.hostRevision={revision}", "-o", str(binary), "."], work, env)
            binaries[revision] = hashlib.sha256(binary.read_bytes()).hexdigest()
            (output / f"{revision}-build.txt").write_text(run(["go", "version", "-m", str(binary)], work, env, capture=True))
        if binaries["before"] == binaries["after"]:
            raise RuntimeError("Expected distinct host executables")
        results = []
        for revision, mode in [("before", "initialize"), ("after", "verify"),
                               ("after", "negative-schema"), ("after", "negative-metadata"),
                               ("after", "negative-parameters"),
                               ("after", "verify")]:
            result = json.loads(run([str(work / revision), mode, str(work / "db")], work, env, capture=True))
            if results and result["ibc_store_sha256"] != results[0]["ibc_store_sha256"]:
                raise RuntimeError("Client store changed across host replacement")
            results.append(result)
        (output / "result.json").write_text(json.dumps({
            "scope": "published-module store restart and proof verification; no live packet relay",
            "ibc_go_major": args.major, "origins": origins,
            "host_binary_sha256": binaries, "checks": results,
        }, indent=2) + "\n")
    print(f"PASS: released v{args.major} module retained the original client store; evidence: {output}")


if __name__ == "__main__":
    main()
