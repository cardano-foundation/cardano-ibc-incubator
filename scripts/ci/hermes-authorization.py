#!/usr/bin/env python3
"""Transfer the compiled Hermes authorization test between jobs in one CI run."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TEST = 'production_gateway_transactions_pass_independent_policy'
BINARY = 'ibc-relayer-tests'


def revision():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def test_name(binary):
    listing = subprocess.check_output([str(binary), '--list', '--ignored'], text=True)
    names = [line.removesuffix(': test') for line in listing.splitlines()
             if line.endswith(': test') and line.removesuffix(': test').split('::')[-1] == TEST]
    if len(names) != 1:
        raise ValueError(f'Expected exactly one ignored Gateway authorization test, got {names}')
    return names[0]


def select_binary(build_report):
    binaries = []
    for line in build_report.read_text().splitlines():
        record = json.loads(line)
        if (record.get('reason') == 'compiler-artifact' and
                record.get('target', {}).get('name') == 'ibc_relayer' and
                record.get('target', {}).get('kind') == ['lib'] and
                record.get('profile', {}).get('test') is True and record.get('executable')):
            binaries.append(Path(record['executable']).resolve())
    if len(binaries) != 1:
        raise ValueError(f'Expected exactly one ibc-relayer library test executable, got {binaries}')
    return binaries[0]


def pack(build_report, archive):
    binary = select_binary(build_report)
    name = test_name(binary)
    data = binary.read_bytes()
    manifest = {'sourceSha': revision(), 'binarySha256': hashlib.sha256(data).hexdigest(), 'test': name}
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'w:gz', compresslevel=3) as output:
        for filename, content, mode in [
            (BINARY, data, 0o755),
            ('manifest.json', json.dumps(manifest).encode(), 0o644),
        ]:
            entry = tarfile.TarInfo(filename)
            entry.size = len(content)
            entry.mode = mode
            output.addfile(entry, io.BytesIO(content))


def authorize(archive, evidence):
    if not evidence.is_file():
        raise ValueError(f'Gateway signing evidence is missing: {evidence}')
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        if sorted(item.name for item in members) != [BINARY, 'manifest.json'] or not all(item.isfile() for item in members):
            raise ValueError('Unexpected authorization archive contents')
        manifest = json.load(source.extractfile('manifest.json'))
        data = source.extractfile(BINARY).read()
    if manifest.get('sourceSha') != revision():
        raise ValueError('Hermes test executable was built for a different source revision')
    if manifest.get('binarySha256') != hashlib.sha256(data).hexdigest():
        raise ValueError('Hermes test executable checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='hermes-authorization-') as temporary:
        binary = Path(temporary) / BINARY
        binary.write_bytes(data)
        binary.chmod(0o755)
        name = test_name(binary)
        if manifest.get('test') != name:
            raise ValueError('Hermes authorization test does not match the build manifest')
        subprocess.run([str(binary), '--exact', name, '--ignored', '--test-threads=1'],
                       env=dict(os.environ, IBC_CACHE_SIGNING_EVIDENCE=str(evidence.resolve())), check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('pack')
    build.add_argument('--build-report', type=Path, required=True)
    build.add_argument('--archive', type=Path, required=True)
    run = commands.add_parser('run')
    run.add_argument('--archive', type=Path, required=True)
    run.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'pack':
        pack(args.build_report, args.archive)
    else:
        authorize(args.archive, args.evidence)


if __name__ == '__main__':
    main()
