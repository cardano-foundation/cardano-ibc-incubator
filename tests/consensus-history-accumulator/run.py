#!/usr/bin/env python3
"""Compile isolated benchmark overlays. Never replace the checkout blueprint."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PRIVATE = Path("lib/ibc/client/ics-007-tendermint-client")


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected exactly one overlay anchor: {old}")
    return source.replace(old, new, 1)


def run(command, cwd, log):
    print("Running", " ".join(str(part) for part in command), flush=True)
    with log.open("w") as output:
        subprocess.run(command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, check=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--aiken", default="aiken")
    parser.add_argument("--deno", default="deno")
    parser.add_argument("--stages", default="baseline,ablation,accumulator")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    summary = {
        "label": "signed-emulator",
        "ablationIsValidImplementation": False,
        "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "aiken": subprocess.check_output([args.aiken, "--version"], text=True).strip(),
        "parametersSha256": sha(ROOT / "cardano/offchain/scripts/fixtures/mainnet-protocol-parameters.json"),
        "experimentSources": {str(path.relative_to(HERE)): sha(path) for path in sorted(HERE.rglob("*")) if path.suffix in {".py", ".ts", ".ak"}},
        "stages": {},
    }
    insert = """consensus_history.insert(
      datum.history_root,
      consensus_history.from_client(datum),
      update.history_siblings,
    ) == next.history_root"""
    fixture_path = ROOT / "cardano/offchain/scripts/tendermint-cache-fixture.ts"
    for stage in args.stages.split(","):
        if stage not in {"baseline", "ablation", "accumulator"}:
            raise ValueError(f"Unknown stage: {stage}")
        directory = output / stage
        directory.mkdir(exist_ok=True)
        onchain = directory / "onchain"
        shutil.copytree(ROOT / "cardano/onchain", onchain, dirs_exist_ok=True)
        update_path = onchain / PRIVATE / "cached/update.ak"
        update = update_path.read_text()
        fixture = fixture_path.read_text()
        if stage == "ablation":
            update = replace_once(update, insert, "True")
            update = replace_once(update, "use ibc/client/ics_007_tendermint_client/consensus_history\n", "")
        if stage == "accumulator":
            shutil.copy(HERE / "onchain/experimental_history.ak", onchain / PRIVATE)
            update = "use ibc/client/ics_007_tendermint_client/experimental_history\n" + update
            update = replace_once(update, "consensus_history.insert(\n      datum.history_root,\n      consensus_history.from_client(datum),", "experimental_history.append(\n      datum.history_root,\n      consensus_history.value(consensus_history.from_client(datum)),")
            fixture = 'import { Archive } from "' + (HERE / "frontier.ts").as_uri() + '";\n' + fixture
            fixture = replace_once(fixture, "const historicalSnapshot: [string, string][] = [];", "const experimentalArchive = new Archive();\n  const historicalSnapshot: [string, string][] = [];")
            fixture = replace_once(fixture, "history.set(key, value);\n  }\n  if (historicalSnapshot.length)", "history.set(key, value);\n    experimentalArchive.append(value);\n  }\n  if (true)")
            fixture = replace_once(fixture, "clientDatum.fields[2] = await history.getRoot();", "clientDatum.fields[2] = experimentalArchive.root();")
            fixture = replace_once(fixture, "const historySiblings = await history.getSiblings(archivedKey);", "const historySiblings = [...experimentalArchive.peaks];\n    experimentalArchive.append(encodeConsensusHistoryRecord(archivedRecord));")
            fixture = replace_once(fixture, 'mutation === "history" ? "ff".repeat(32) : await history.getRoot(),', 'mutation === "history" ? "ff".repeat(32) : experimentalArchive.root(),')
            fixture = fixture.replace("compactStateSiblings(historySiblings)", "historySiblings")
            run([args.deno, "run", "-A", "--config", ROOT / "cardano/offchain/deno.json", HERE / "vectors.ts", onchain / PRIVATE / "experimental_history.test.ak", directory / "vectors.json"], ROOT, directory / "vectors.log")
            run([args.aiken, "check", "--deny", "--trace-level", "silent", "-m", "experimental_history.{..}", "--seed", "462", "--max-success", "1"], onchain, directory / "tests.json")
        update_path.write_text(update)
        run([args.aiken, "build", "--deny", "--trace-level", "silent"], onchain, directory / "build.log")
        # Moving the fixture requires preserving the original targets of every
        # relative import. The only substituted dependency is the blueprint.
        fixture = re.sub(r'(["\'])(\.{1,2}/[^"\']+)\1', lambda match: '"' + (fixture_path.parent / match[2]).resolve().as_uri() + '"', fixture)
        copied_fixture = directory / "fixture.ts"
        copied_fixture.write_text(fixture)
        config = json.loads((ROOT / "cardano/offchain/deno.json").read_text())
        imports = config["imports"]
        for key, value in list(imports.items()):
            if value.startswith("."):
                imports[key] = (ROOT / "cardano/offchain" / value).resolve().as_uri()
        imports[(ROOT / "cardano/onchain/plutus.json").as_uri()] = (onchain / "plutus.json").as_uri()
        imports[fixture_path.as_uri()] = copied_fixture.as_uri()
        config_path = directory / "deno.json"
        config_path.write_text(json.dumps(config))
        command = [args.deno, "run", "-A", "--config", config_path, HERE / "measure.ts", directory / "measurements.json"]
        if stage == "accumulator":
            command.append("--candidate")
        run(command, ROOT, directory / "measure.log")
        measurements = json.loads((directory / "measurements.json").read_text())
        summary["stages"][stage] = {
            "blueprintSha256": sha(onchain / "plutus.json"),
            "measurementsSha256": sha(directory / "measurements.json"),
            "cases": [{key: result[key] for key in ["historyRecords", "path", "completeFee", "updateTransactions", "signatures", "transactionId", "measured", "feeComponents"]} for result in measurements],
        }
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
