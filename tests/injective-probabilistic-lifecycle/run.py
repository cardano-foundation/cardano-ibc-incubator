#!/usr/bin/env python3
"""Run the sole supported probabilistic client storage format."""
import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("run_bounded.py")), run_name="__main__")
