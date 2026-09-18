#!/usr/bin/env python3
"""Archive actual Praos epoch stake snapshots from the owned disposable node.

This reads the node's ledger stakeDistrib, not live wallet stake or a synthetic
normalization. The Gateway checks the captured tip against canonical history on
EVERY read and can select an earlier canonical capture after a rollback.
"""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]

def publish(destination, data, replace=False):
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.capture-', delete=False) as file:
        temporary = Path(file.name)
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    try:
        if replace:
            os.replace(temporary, destination)
        else:
            try: os.link(temporary, destination)
            except FileExistsError: pass
    finally:
        temporary.unlink(missing_ok=True)

def capture(runtime, project, reuse_epoch=False):
    if not runtime.is_relative_to(ROOT / '.deployment-smoke') or not project.startswith('cardano-deployment-test-'):
        raise ValueError('Explicit disposable runtime required')
    raw_genesis = (runtime / 'runtime/genesis-shelley.json').read_bytes()
    genesis = json.loads(raw_genesis)
    if genesis['networkMagic'] != 42:
        raise ValueError('Only the owned magic-42 devnet is supported')
    compose = ['docker', 'compose', '-p', project, '-f', str(runtime / 'compose.json')]
    command = compose + ['exec', '-T', 'node', 'cardano-cli', 'conway', 'query']
    def query(name):
        return subprocess.check_output(command + [name, '--testnet-magic', '42'])
    def canonical(point):
        block_hash = point['hash']
        if len(block_hash) != 64 or any(c not in '0123456789abcdef' for c in block_hash):
            raise ValueError('Invalid node block hash')
        sql = f"SELECT count(*) FROM block WHERE number={int(point['block'])} AND slot={int(point['slot'])} AND epoch={int(point['epoch'])} AND hash='{block_hash}'"
        count = subprocess.check_output(compose + ['exec', '-T', 'history-db', 'psql', '-U', 'postgres', '-d', 'migration_yaci', '-Atc', sql], text=True).strip()
        return count == '1'
    directory = runtime / 'epoch-stake'
    if reuse_epoch:
        # Praos uses the fixed ledger pool distribution for this epoch. Reuse
        # only an actual archived capture with unchanged genesis/raw evidence
        # and a point still present in canonical history; otherwise recapture.
        now = json.loads(query('tip'))
        previous = directory / f'{now["epoch"]}.json'
        if previous.exists():
            saved = json.loads(previous.read_text())
            digest = saved['ledgerSha256']
            if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                raise ValueError('Invalid saved ledger digest')
            if saved['epoch'] != now['epoch'] or saved['genesisNonce'] != hashlib.blake2b(raw_genesis, digest_size=32).hexdigest():
                raise ValueError('Epoch archive belongs to another network or epoch')
            if hashlib.sha256((directory / (digest + '.ledger.json')).read_bytes()).hexdigest() != digest:
                raise ValueError('Archived raw ledger has changed')
            point = {'hash':saved['blockHash'], 'block':saved['blockHeight'], 'slot':saved['slot'], 'epoch':saved['epoch']}
            if int(point['slot']) <= now['slot'] and canonical(point):
                print(json.dumps({'epoch':saved['epoch'], 'blockHeight':int(saved['blockHeight']), 'ledgerSha256':digest, 'reusedCanonicalEpoch':True}), flush=True)
                return saved['epoch']
    for _ in range(30):
        before = json.loads(query('tip'))
        raw_ledger = query('ledger-state')
        ledger = json.loads(raw_ledger)
        after = json.loads(query('tip'))
        if before['hash'] == after['hash'] and ledger['lastEpoch'] == after['epoch']:
            break
    else:
        raise RuntimeError('Could not capture ledger and tip at the same block')
    distribution = ledger['stakeDistrib']
    total = distribution['pdTotalActiveStake']
    pools = []
    for pool_id, pool in sorted(distribution['unPoolDistr'].items()):
        stake = pool['individualTotalPoolStake']
        fraction = pool['individualPoolStake']
        if stake <= 0 or fraction['numerator'] * total != fraction['denominator'] * stake:
            raise ValueError('Inconsistent ledger stake fraction')
        pools.append({'poolId': pool_id, 'vrfKeyHash': pool['individualPoolStakeVrf'], 'stake': str(stake)})
    if any(genesis['staking']['pools'].get(pool['poolId'], {}).get('vrf') != pool['vrfKeyHash'] for pool in pools):
        raise ValueError('This rehearsal supports only the actual genesis pools and their original VRFs')
    if total <= 0 or sum(int(pool['stake']) for pool in pools) != total:
        raise ValueError('Incomplete ledger pool distribution')
    directory.mkdir(exist_ok=True)
    publish(directory / 'genesis-shelley.json', raw_genesis)
    if (directory / 'genesis-shelley.json').read_bytes() != raw_genesis:
        raise ValueError('Snapshot archive belongs to a different genesis')
    # Do not publish ahead of canonical history ingestion. All values below
    # come from the local node; validate them before constructing the query.
    for _ in range(30):
        if canonical(after):
            break
        time.sleep(1)
    else:
        raise RuntimeError('Captured snapshot point is not in canonical retained history')
    ledger_hash = hashlib.sha256(raw_ledger).hexdigest()
    ledger_file = directory / (ledger_hash + '.ledger.json')
    # Keep raw evidence for independent comparison; do not overwrite it.
    publish(ledger_file, raw_ledger)
    snapshot = {'schema': 1, 'networkMagic': 42, 'genesisNonce': hashlib.blake2b(raw_genesis, digest_size=32).hexdigest(),
        'epoch': after['epoch'], 'blockHash': after['hash'], 'blockHeight': str(after['block']), 'slot': str(after['slot']),
        'totalActiveStake': str(total), 'pools': pools, 'ledgerSha256': ledger_hash}
    archive = directory / str(after['epoch'])
    archive.mkdir(exist_ok=True)
    # Retain the previous capture's metadata as well as raw ledger bytes. A
    # rollback of the latest point must not erase an earlier canonical witness.
    previous_file = directory / f'{after["epoch"]}.json'
    captures = [snapshot]
    if previous_file.exists():
        captures.append(json.loads(previous_file.read_text()))
    for capture in captures:
        name = f'{int(capture["blockHeight"]):020d}-{capture["blockHash"]}.json'
        destination = archive / name
        publish(destination, (json.dumps(capture, indent=2) + '\n').encode())
    publish(previous_file, (json.dumps(snapshot, indent=2) + '\n').encode(), replace=True)
    print(json.dumps({'epoch': after['epoch'], 'blockHeight': after['block'], 'ledgerSha256': ledger_hash}), flush=True)
    return after['epoch']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--reuse-canonical-epoch', action='store_true', help='Reuse a hash-checked actual snapshot only while its epoch and captured point remain canonical')
    args = parser.parse_args()
    while True:
        capture(args.runtime.resolve(), args.project, args.reuse_canonical_epoch)
        if not args.watch:
            break
        time.sleep(30)

if __name__ == '__main__':
    main()
