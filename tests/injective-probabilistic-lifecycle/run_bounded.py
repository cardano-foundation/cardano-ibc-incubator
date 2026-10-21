#!/usr/bin/env python3
"""Run the native Injective binary with a controlled clock through socket ABCI."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path
from harness import Node, read, write

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('--fixture', choices=['size', 'limit', 'combined', 'lifecycle'], default='size')
parser.add_argument('--small-proposal', action='store_true')
parser.add_argument('--resume', action='store_true')
parser.add_argument('--discard-attacks', action='store_true', help='interleave a second account\'s discard attempts with an honest challenge')
parser.add_argument('--image', default='local/injective-bounded-verification')
parser.add_argument('--helper', default='local/injective-bounded-verification-probe')
args = parser.parse_args()
root = args.output.resolve()
if root.exists() and not args.resume:
    raise RuntimeError('Use a fresh output directory or --resume')
root.mkdir(parents=True, exist_ok=True)
if args.discard_attacks:
    (root / 'test-session-discard').touch()
repo = Path(__file__).resolve().parents[2]
def helper(*command):
    return subprocess.check_output(['docker', 'run', '--rm', '-v', f'{root}:/out', args.helper, *command], text=True)

if not args.resume:
    shutil.copytree(Path(__file__).parent / 'evidence/network-snapshot', root / 'network-snapshot')
    if args.fixture != 'lifecycle':
        shutil.copy(repo / f'cosmos/cardano-probabilistic-light-client-core/testdata/native-boundary-{args.fixture}.json.gz', root / 'fixture.json.gz')

    (root / 'operator-address.txt').write_text(helper('address'))
    helper('key', '/out/operator-key.hex')
    if args.fixture == 'lifecycle':
        import os
        env = os.environ.copy()
        env.update(GOWORK='off', INJECTIVE_LIFECYCLE_FIXTURE_DIR=str(root), INJECTIVE_LIFECYCLE_RECEIVER=(root / 'operator-address.txt').read_text().strip())
        subprocess.run(['go', 'test', '-run', '^TestExportInjectiveLifecycleHistory$', '-count=1'], cwd=repo / 'cosmos/cardano-probabilistic-light-client-v8', env=env, check=True)
        helper('lifecycle', '/out', 'normal', '/out')
        helper('bounded-prepare', '/out/source-history.json', 'expanded', '/out')
    else:
        helper('bounded-prepare', '/out/fixture.json.gz', 'expanded', '/out', *(['small-proposal'] if args.small_proposal else []))
    bootstrap = read(root / 'bootstrap.json')
    # Node also accepts the original single-client fixture format.
    bootstrap.update(client=bootstrap['clients'][0], consensus=bootstrap['consensuses'][0], metadata=bootstrap['metadatas'][0])
    node = Node(root, args.image, 'testnet', 0)
    node.initialize(bootstrap)
name = 'cardano-injective-bounded-' + args.fixture
subprocess.run(['docker', 'run', '-d', '--name', name, '-v', f'{root}:/out', args.helper, 'bounded-serve', '/out/testnet'], check=True)
try:
    import time
    for _ in range(120):
        logs = subprocess.check_output(["docker", "logs", name], text=True, stderr=subprocess.STDOUT)
        if "ABCI server ready" in logs:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("Native application server did not start")
    subprocess.run(['docker', 'run', '--rm', '--network', f'container:{name}', '-v', f'{root}:/out', args.helper,
                    'bounded-run', '/out'], check=True)
finally:
    with (root / 'node.log').open('w') as output:
        subprocess.run(['docker', 'logs', name], stdout=output, stderr=subprocess.STDOUT)
    subprocess.run(['docker', 'stop', name], check=True)
    subprocess.run(['docker', 'rm', name], check=True)
