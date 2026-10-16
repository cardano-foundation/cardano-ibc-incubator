#!/usr/bin/env python3
"""Keep reviewable execution results without committing node databases or keys."""

import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--run", action="append", help="include only these named node directories")
    args = parser.parse_args()
    records = []
    for path in sorted(args.output.glob("*/transactions.json")):
        if args.run and path.parent.name not in args.run:
            continue
        for transaction in json.loads(path.read_text()):
            label = transaction["label"]
            committed = transaction["committed"]
            simulation = transaction["simulation"]
            try:
                gas = json.loads(simulation["stdout"])["gas_info"]
            except (json.JSONDecodeError, KeyError):
                gas = None
            result = None if not committed else committed["tx_result"]
            txfile = path.parent / (label + ".tx")
            records.append({
                "run": path.parent.name,
                "label": label,
                "signed_tx_bytes": transaction["signed_tx_bytes"],
                "signed_tx_sha256": hashlib.sha256(txfile.read_bytes()).hexdigest(),
                "gas_wanted": transaction["gas_wanted"],
                "simulation_gas": gas,
                "simulation_error": simulation["stderr"] if simulation["exit_code"] else None,
                "admission": transaction["check_tx"],
                "commit_height": None if not committed else committed["height"],
                "commit_code": None if not result else result["code"],
                "commit_gas_used": None if not result else result["gas_used"],
                "commit_log": None if not result else result["log"],
                "client_changed": transaction["client_changed"],
            })
    lifecycle = []
    for path in sorted(args.output.glob("*/lifecycle-result.json")):
        if args.run and path.parent.name not in args.run:
            continue
        result = json.loads(path.read_text())
        result["run"] = path.parent.name
        result["freeze"] = json.loads((path.parent / "freeze.json").read_text())
        result["restart"] = json.loads((path.parent / "restart.json").read_text())
        lifecycle.append(result)
    runs = sorted({record["run"] for record in records})
    args.destination.write_text(json.dumps({"selected_runs": runs, "transactions": records, "completed_lifecycles": lifecycle}, indent=2) + "\n")


if __name__ == "__main__":
    main()
