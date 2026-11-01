#!/usr/bin/env python3
"""Run the current submit API with DevKit's generated configuration."""

import os
from pathlib import Path
import re
import sys


def main(args):
    if "--config" in args:
        configuration = Path(args[args.index("--config") + 1])
        source = configuration.read_text()
        # DevKit's YAML template only configures the removed logging backend.
        if not re.search(r"^(TraceOptions|HermodTracing|Options):", source, re.MULTILINE):
            temporary = configuration.with_suffix(".tmp")
            temporary.write_text(source.rstrip() + "\nTraceOptions: {}\n")
            temporary.replace(configuration)
    binary = "/usr/local/bin/cardano-submit-api"
    os.execv(binary, [binary, *args])


if __name__ == "__main__":
    main(sys.argv[1:])
