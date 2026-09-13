#!/usr/bin/env python3
"""Prepare DevKit's generated genesis and Docker connections before node launch."""

import json
import os
from pathlib import Path
import re
import sys


def argument_path(args, flag):
    if flag not in args or args.index(flag) + 1 == len(args):
        raise ValueError(f"DevKit node launch did not provide a {flag[2:]} file")
    return Path(args[args.index(flag) + 1])


def prepare_genesis(args, peer):
    configuration = argument_path(args, "--config")
    source = configuration.read_text()

    def genesis_path(field):
        match = re.search(rf"^{field}:\s*(\S+)\s*$", source, re.MULTILINE)
        if match is None:
            raise ValueError(f"Missing native DevKit configuration field: {field}")
        return configuration.parent / match[1]

    byron_path = genesis_path("ByronGenesisFile")
    byron = json.loads(byron_path.read_text())
    shelley = json.loads(genesis_path("ShelleyGenesisFile").read_text())
    if shelley.get("securityParam") != 48:
        raise ValueError("Expected DevKit Shelley securityParam 48")
    if byron.get("protocolConsts", {}).get("k") == 48:
        return
    database = argument_path(args, "--database-path")
    if database.exists() and (not database.is_dir() or any(database.iterdir())):
        raise ValueError("Retained DevKit genesis has mismatched security parameters, reset the DevKit network")
    if peer or byron.get("protocolConsts", {}).get("k") != 10:
        raise ValueError("Unexpected DevKit Byron security parameter")
    # DevKit 0.10.6's securityParam setting changes only Shelley. Its fixed
    # Byron k=10 also limits retained ledger queries, below our proof depth 24.
    # Native join downloads this corrected genesis from main for every peer.
    byron["protocolConsts"]["k"] = 48
    temporary = byron_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(byron, indent=2) + "\n")
    temporary.replace(byron_path)


def main(args):
    peer = os.environ.get("DEVKIT_PEER") == "true"
    if args[:1] == ["run"]:
        prepare_genesis(args, peer)
    if args[:1] == ["run"] and not peer:
        # DevKit generates each peer's connection to main. Its main template
        # only points to localhost, so provide the reverse connections before
        # forging starts, including when the saved network is restarted.
        path = argument_path(args, "--topology")
        topology = json.loads(path.read_text())
        topology["localRoots"] = [{
            "accessPoints": [{"address": f"producer-{index}.local", "port": 3001} for index in range(2, 6)],
            "valency": 4,
        }]
        topology["publicRoots"] = []
        path.write_text(json.dumps(topology, indent=2) + "\n")
    binary = "/usr/local/bin/cardano-node"
    os.execv(binary, [binary, *args])


if __name__ == "__main__":
    main(sys.argv[1:])
