#!/usr/bin/env python3
"""Build a rehearsal successor with a real additional spending constraint.

The source baseline and immutable policies are never edited. The replacement
roles impose a finite normal-operation validity window; the independent
migration branch is preserved. This is a test release, not a production proposal.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--window-ms", type=int, required=True)
    args = parser.parse_args()
    if args.window_ms not in {300000, 600000, 900000}:
        parser.error("rehearsal releases use a 300000, 600000 or 900000 ms normal-operation window; the 300000 fixture does not support the production staged-client update window")
    target = args.out.resolve()
    target.mkdir(parents=True, exist_ok=False)
    source = ROOT / "cardano/onchain"
    for directory in ["lib", "validators"]:
        shutil.copytree(source / directory, target / directory)
    for name in ["aiken.toml", "aiken.lock"]:
        shutil.copy2(source / name, target / name)
    for role in ["host_state", "client", "connection", "channel", "transfer"]:
        path = target / "validators/upgradeable" / f"{role}.ak"
        content = path.read_text()
        # Match the wrapper's first branch boundary, never a production library.
        anchor = "\n    } else {\n"
        if content.count(anchor) != 1:
            raise RuntimeError(f"Wrapper shape changed: review successor fixture for {role}")
        content = "use ibc/utils/validator_utils as migration_window\n" + content.replace(anchor, anchor +
            f"      expect migration_window.get_tx_valid_to(transaction.validity_range) - migration_window.get_tx_valid_from(transaction.validity_range) <= {args.window_ms}\n", 1)
        path.write_text(content)
    subprocess.run(["aiken", "fmt"], cwd=target, check=True)
    subprocess.run(["aiken", "build", "--deny", "--trace-level", "silent"], cwd=target, check=True)
    digest = hashlib.sha256((target / "plutus.json").read_bytes()).hexdigest()
    (target / "release.json").write_text(json.dumps({"purpose": "migration rehearsal", "windowMs": args.window_ms,
        "blueprintSha256": digest, "replacedRoles": ["host_state", "client", "connection", "channel", "transfer"]}, indent=2) + "\n")
    print(json.dumps({"blueprint": str(target / "plutus.json"), "sha256": digest}))


if __name__ == "__main__":
    main()
