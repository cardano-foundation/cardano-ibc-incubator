#!/usr/bin/env python3
"""Materialize the checksum-pinned evaluator and its single costing correction."""
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
SHA256 = '4a551c4786ef2045b2d05297eec4bffc84ada7e6058f414c5d3550a62a4ffcbb'
with urllib.request.urlopen('https://static.crates.io/crates/uplc/uplc-1.1.22.crate', timeout=60) as response:
    archive = response.read()
if hashlib.sha256(archive).hexdigest() != SHA256:
    raise RuntimeError('Upstream evaluator archive checksum mismatch')
destination = ROOT / '.upstream'
destination.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
    package.extractall(destination, filter='data')
path = destination / 'uplc-1.1.22/src/machine/cost_model.rs'
source = path.read_text()
before = 'if costs.len() == 297 {'
if source.count(before) != 1:
    raise RuntimeError('Review the evaluator patch: expected exactly one cost-model length guard')
# Ledger cost models may append parameters. Existing builtin costs must still
# be loaded. Do not truncate/alter the supplied model or enable new builtins.
path.write_text(source.replace(before, 'if costs.len() >= 297 {'))
print('Verified uplc 1.1.22 archive and applied the appended-cost-model correction')
