#!/usr/bin/env python3
"""Hermes process fixture for heartbeat lifecycle tests."""
import pathlib
import sys
import time

assert sys.argv[1] == "--config"
config = pathlib.Path(sys.argv[2]).read_text()
if sys.argv[3:] == ["config", "validate"]:
    assert "refresh = true" in config
    sys.exit(0)
assert sys.argv[3:] == ["--json", "start", "--full-scan"]
assert "refresh = false" in config
if "# heartbeat_test_fail_start" in config:
    print("fixture startup failure", flush=True)
    sys.exit(4)
print("spawning Wallet worker: wallet::cardano-devnet", flush=True)
while True:
    time.sleep(1)
