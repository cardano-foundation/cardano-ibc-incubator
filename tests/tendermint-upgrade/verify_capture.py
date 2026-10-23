#!/usr/bin/env python3
"""Recheck a retained public SDK capture without running either local chain."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def verify(path):
    with tempfile.TemporaryDirectory(prefix='verify-upgrade-capture-') as temporary:
        source = Path(temporary) / 'main.go'
        source.write_text(Path(__file__).with_name('verify-capture.go.tmpl').read_text())
        return json.loads(subprocess.check_output(['go', 'run', '-mod=readonly', str(source), str(path.resolve())],
            cwd=ROOT/'cosmos/cardano-probabilistic-light-client-v8',
            env=dict(os.environ, GOTOOLCHAIN='go1.26.9', GOWORK='off'), text=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    args = parser.parse_args()
    result = verify(args.capture)
    retained = json.loads(args.capture.read_text())['reference_verification']
    if result != retained:
        raise RuntimeError('Recomputed verification differs from the retained evidence')
    print(json.dumps(result, indent=2))
