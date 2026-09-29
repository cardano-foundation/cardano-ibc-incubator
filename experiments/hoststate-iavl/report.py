"""Join independently generated witness sizes and measured execution costs."""
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


def version(command):
    return subprocess.check_output(command, text=True).strip().splitlines()[0]


measurements = {row["name"]: row for row in read("artifacts/measurements.json")}
tests = read("artifacts/aiken-results.json")
if tests["summary"]["failed"]:
    raise SystemExit("Aiken tests failed")
selected = []
for module in tests["modules"]:
    for test in module["tests"]:
        name = test["title"]
        if name.startswith(("send_packet_", "create_channel_", "bucket_", "mature_", "insert_", "update_", "delete_65536")) and name in measurements:
            row = measurements[name]
            selected.append({**row, **test["execution_units"], "status": test["status"]})

report = {
    "base_commit": "94db12d0644294bb0ac8f09ede920a1980c5bc6a",
    "tools": {
        "aiken": version(["aiken", "--version"]),
        "go": version(["go", "version"]),
        "deno": version(["deno", "--version"]),
    },
    "limits": {"signed_bytes": 16384, "memory": 16500000, "cpu": 10000000000},
    "aiken_tests": tests["summary"],
    "single_and_batch_function_costs": selected,
    "signed_kernel_transactions": read("artifacts/transaction-costs.json"),
    "scope": "Kernel transactions include decoding, fees, collateral and reference scripts. They do not include full IBC validation. Collision fixtures force matching digest prefixes.",
}
baseline_log = ROOT / "artifacts/production-budgets.log"
if baseline_log.exists():
    baseline = []
    values = re.findall(r"bytes: (\d+), memory: (\d+)n, cpu: (\d+)n", baseline_log.read_text())
    if len(values) != 3:
        raise SystemExit("Expected all three production baseline measurements")
    for name, values in zip(
        ["First native SendPacket at 64 commitments", "ChanOpenInit", "ChanOpenTry"],
        values,
    ):
        baseline.append(dict(name=name, signed_bytes=int(values[0]), memory=int(values[1]), cpu=int(values[2])))
    if len(baseline) != 3:
        raise SystemExit("Expected all three production baseline measurements")
    report["production_baseline_transactions"] = baseline
(ROOT / "results.json").write_text(json.dumps(report, indent=2) + "\n")
for row in report["signed_kernel_transactions"]:
    if "error" in row:
        raise SystemExit(f"Failed transaction: {row}")
    if row["name"].endswith("65536"):
        print(f'{row["name"]}: {row["signed_bytes"]:,} bytes, '
              f'{row["memory"]:,} memory, {row["cpu"]:,} CPU')
