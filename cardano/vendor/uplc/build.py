#!/usr/bin/env python3
"""Rebuild the pinned evaluator; --write records explicitly reviewed artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
if subprocess.check_output(['wasm-pack', '--version'], text=True).strip() != 'wasm-pack 0.13.1':
    raise RuntimeError('Reproduction requires wasm-pack 0.13.1')
subprocess.run([sys.executable, str(root / 'prepare-upstream.py')], check=True)
for target, output in [('nodejs', 'node'), ('bundler', 'browser')]:
    subprocess.run(['wasm-pack', 'build', '--target', target, '--out-dir', '../dist/' + output,
                    '--release', '--', '--locked'], cwd=root / 'rust', check=True)
    # Keep one package manifest at the root; generated nested metadata is not
    # part of the runtime artifact and contains no dependency provenance.
    for name in ['package.json', '.gitignore']:
        (root / 'dist' / output / name).unlink(missing_ok=True)
paths = sorted([p for p in (root / 'dist').rglob('*') if p.is_file()] + [
    root / 'rust/Cargo.toml', root / 'rust/Cargo.lock', root / 'rust/rust-toolchain.toml',
    root / 'rust/src/lib.rs', root / 'prepare-upstream.py', root / 'build.py', root / 'package.json',
])
digests = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
manifest = root / 'artifact-sha256.json'
if args.write:
    manifest.write_text(json.dumps(digests, indent=2) + '\n')
elif json.loads(manifest.read_text()) != digests:
    raise RuntimeError('Evaluator rebuild differs from recorded artifacts; retain and review the difference')
print('Evaluator artifact hashes verified' if not args.write else 'Evaluator artifact hashes recorded')
