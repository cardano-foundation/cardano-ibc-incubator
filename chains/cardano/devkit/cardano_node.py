#!/usr/bin/env python3
"""Prepare DevKit's generated genesis and Docker connections before node launch."""

import json
import os
from pathlib import Path
import re
import sys
from bootstrap import seed


def argument_path(args, flag):
    if flag not in args or args.index(flag) + 1 == len(args):
        raise ValueError(f"DevKit node launch did not provide a {flag[2:]} file")
    return Path(args[args.index(flag) + 1])


def prepare_genesis(args, peer):
    expected_security = int(os.environ.get("DEVKIT_SECURITY_PARAM", "48"))
    if expected_security not in {48, 2160}:
        raise ValueError("Unsupported DevKit security parameter")
    configuration = argument_path(args, "--config")
    source = configuration.read_text()
    fields = json.loads(source) if source.lstrip().startswith("{") else None

    def genesis_path(field):
        if fields is not None:
            return configuration.parent / fields[field]
        match = re.search(rf"^{field}:\s*(\S+)\s*$", source, re.MULTILINE)
        if match is None:
            raise ValueError(f"Missing native DevKit configuration field: {field}")
        return configuration.parent / match[1]

    shelley_path = genesis_path("ShelleyGenesisFile")
    shelley = json.loads(shelley_path.read_text())
    if shelley.get("securityParam") != expected_security:
        raise ValueError(f"Expected DevKit Shelley securityParam {expected_security}")
    conway_path = genesis_path("ConwayGenesisFile")
    conway = json.loads(conway_path.read_text())
    alonzo_path = genesis_path("AlonzoGenesisFile")
    alonzo = json.loads(alonzo_path.read_text())
    parameters = json.loads((Path(__file__).resolve().parents[1] / "config/protocol-parameters.json").read_text())
    expected_models = parameters["costModels"]
    expected_v3 = expected_models["PlutusV3"]
    if parameters["protocolVersion"]["major"] != 11 or len(expected_v3) != 350:
        raise ValueError("Expected the pinned protocol-11 PlutusV3 cost model")
    if shelley.get("protocolParams", {}).get("protocolVersion", {}).get("major") != 11:
        raise ValueError("DevKit requires protocol version 11, reset the DevKit network")
    # Conway's genesis parser fixes this field at the original 251 entries.
    # The ledger's test-network override installs the complete current models
    # after the era transition, as in cardano-node's workbench.
    if (conway.get("plutusV3CostModel") != expected_v3[:251]
            or alonzo.get("extraConfig", {}).get("costModels") != expected_models):
        database = argument_path(args, "--database-path")
        if database.exists() and (not database.is_dir() or any(database.iterdir())):
            raise ValueError("Retained DevKit cost model differs from protocol 11, reset the DevKit network")
        conway["plutusV3CostModel"] = expected_v3[:251]
        alonzo.setdefault("extraConfig", {})["costModels"] = expected_models
        for path, value in [(conway_path, conway), (alonzo_path, alonzo)]:
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(value, indent=2) + "\n")
            temporary.replace(path)

    # DevKit enables development hard forks in its template. Protocol 11 uses
    # Conway and must not ask the node to initialize experimental Dijkstra.
    if fields is not None:
        fields["ExperimentalHardForksEnabled"] = False
        fields.pop("TestEnableDevelopmentHardForkEras", None)
        # Node 11 requires the dispatcher configuration. An empty map keeps
        # its default tracing when DevKit supplies only the older log options.
        fields.setdefault("TraceOptions", {})
        updated = json.dumps(fields, indent=2) + "\n"
    else:
        updated = re.sub(r"^(ExperimentalHardForksEnabled|TestEnableDevelopmentHardForkEras):[^\n]*\n?",
                         "", source, flags=re.MULTILINE)
        updated = updated.rstrip() + "\n"
        if not re.search(r"^TraceOptions:", updated, re.MULTILINE):
            updated += "TraceOptions: {}\n"
        updated += "ExperimentalHardForksEnabled: false\n"
    if updated != source:
        temporary = configuration.with_suffix(".tmp")
        temporary.write_text(updated)
        temporary.replace(configuration)

    byron_path = genesis_path("ByronGenesisFile")
    byron = json.loads(byron_path.read_text())
    if byron.get("protocolConsts", {}).get("k") == expected_security:
        return
    database = argument_path(args, "--database-path")
    if database.exists() and (not database.is_dir() or any(database.iterdir())):
        raise ValueError("Retained DevKit genesis has mismatched security parameters, reset the DevKit network")
    if peer or byron.get("protocolConsts", {}).get("k") != 10:
        raise ValueError("Unexpected DevKit Byron security parameter")
    # DevKit's securityParam setting changes only Shelley. Pin both eras to
    # the selected fixture parameter before the first block is produced.
    # Native join downloads this corrected genesis from main for every peer.
    byron["protocolConsts"]["k"] = expected_security
    temporary = byron_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(byron, indent=2) + "\n")
    temporary.replace(byron_path)


def seed_producers(args, manifest=Path("/bootstrap/pools.json")):
    configuration = argument_path(args, "--config")
    marker = configuration.parent / "genesis-seeded"
    if marker.exists():
        return
    database = argument_path(args, "--database-path")
    if database.exists() and (not database.is_dir() or any(database.iterdir())):
        raise ValueError("Cannot seed pools into an existing chain, reset the DevKit network")
    # DevKit's native template places Shelley genesis here for main and peers.
    path = configuration.parent / "genesis/shelley-genesis.json"
    genesis = json.loads(path.read_text())
    seed(genesis, json.loads(manifest.read_text()))
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(genesis, indent=2) + "\n")
    temporary.replace(path)
    marker.touch()


def main(args):
    peer = os.environ.get("DEVKIT_PEER") == "true"
    if args[:1] == ["run"]:
        prepare_genesis(args, peer)
    if args[:1] == ["run"] and not peer:
        seed_producers(args)
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
    if args[:1] == ["run"] and peer and os.environ.get("DEVKIT_FULL_MESH") == "true":
        path = argument_path(args, "--topology")
        topology = json.loads(path.read_text())
        own = os.environ["DEVKIT_PRODUCER"]
        peers = ["devkit", *[f"producer-{index}" for index in range(2, 6)]]
        topology["localRoots"] = [{
            "accessPoints": [{"address": name + ".local", "port": 3001} for name in peers if name != own],
            "valency": 4,
        }]
        topology["publicRoots"] = []
        path.write_text(json.dumps(topology, indent=2) + "\n")
    if args[:1] == ["run"] and os.environ.get("DEVKIT_CLOCK_FILE"):
        # Clock jumps must not advance Cardano's monotonic timers. The Java CLI
        # keeps its own setting from entrypoint.sh for its timed waits.
        os.environ["FAKETIME_DONT_FAKE_MONOTONIC"] = "1"
    binary = "/usr/local/bin/cardano-node"
    os.execv(binary, [binary, *args])


if __name__ == "__main__":
    main(sys.argv[1:])
