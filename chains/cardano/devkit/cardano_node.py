#!/usr/bin/env python3
"""Connect DevKit's main node directly to its four Docker peers."""

import json
import os
from pathlib import Path
import sys


def main(args):
    if args[:1] == ["run"] and os.environ.get("DEVKIT_PEER") != "true":
        # DevKit generates each peer's connection to main. Its main template
        # only points to localhost, so provide the reverse connections before
        # forging starts, including when the saved network is restarted.
        if "--topology" not in args or args.index("--topology") + 1 == len(args):
            raise ValueError("DevKit node launch did not provide a topology file")
        path = Path(args[args.index("--topology") + 1])
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
