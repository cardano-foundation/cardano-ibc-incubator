#!/usr/bin/env python3
"""Roll back a real migration move on a minority fork of an owned five-pool devnet.

Disconnect only its primary producer, execute one production CLI step, let that
transaction expire on the four-producer branch, and reconnect. Verify the old
registry UTxO against each node's ledger before resuming from the same outbox.
This is destructive only to the explicitly selected disposable fork; never use
network magic, manifest labels, or an indexer alone as ownership evidence.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
NODES = ['node', 'spo2', 'spo3', 'spo4', 'spo5']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['runtime', 'artifacts-dir', 'handler', 'plan']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    runtime, artifacts, handler, plan = [p.resolve() for p in
                                         [args.runtime, args.artifacts_dir, args.handler, args.plan]]
    if any(not p.is_relative_to(ROOT / '.deployment-smoke') or not p.exists()
           for p in [runtime, artifacts, handler, plan]):
        parser.error('Explicit existing disposable artifacts required')
    result = json.loads((runtime / 'result.json').read_text())
    project = result['project']
    if (result['networkRuntime'] != str(runtime) or result['poolCount'] != 5 or
            not re.fullmatch('cardano-deployment-test-[a-z0-9]+', project)):
        parser.error('Expected an owned five-producer deployment')
    genesis = (runtime / 'runtime/genesis-shelley.json').read_bytes()
    if json.loads(genesis)['networkMagic'] != 42:
        parser.error('Only the owned magic-42 devnet is supported')
    source = json.loads(handler.read_text())
    generation = int(source['migration']['generation']) + 1
    directory = artifacts / f'v{generation}-handover'
    directory.mkdir(exist_ok=True)
    report = directory / ('rollback-' + uuid.uuid4().hex + '.json')
    evidence = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'project': project, 'generation': generation, 'status': 'started',
                'scope': 'Real five-producer minority fork; no claim of production finality'}
    compose = ['docker', 'compose', '-p', project, '-f', str(runtime / 'compose.json')]

    def command(argv):
        return subprocess.check_output(argv, cwd=ROOT, text=True, timeout=90).strip()

    def node(service, args):
        return json.loads(command(compose + ['exec', '-T', service, 'cardano-cli',
                                           'conway', 'query', *args, '--testnet-magic', '42']))

    def registry(service):
        return node(service, ['utxo', '--address', source['migration']['registryAddress'],
                              '--out-file', '/dev/stdout'])

    def tip(service):
        return node(service, ['tip'])

    def wait(label, predicate, seconds=900):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            print(json.dumps({'waiting': label}), flush=True)
            time.sleep(5)
        raise RuntimeError('Timed out: ' + label)

    def control(action, *extra):
        logfile = directory / ('rollback-cli-' + uuid.uuid4().hex + '.log')
        argv = ['python3', str(ROOT / 'scripts/ci/aiken-contract-migration/migration-control.py'), '--runtime', str(runtime),
                '--artifacts-dir', str(artifacts), '--handler', str(handler), '--executor', 'migration',
                '--', action, *extra]
        with logfile.open('x') as output:
            completed = subprocess.run(argv, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=900)
        if completed.returncode:
            raise RuntimeError('Production command failed; retain ' + str(logfile))
        entries = []
        for line in logfile.read_text().splitlines():
            try:
                entries.append(json.loads(line))
            except ValueError:
                pass
        return entries

    for service in NODES:
        actual = subprocess.check_output(compose + ['exec', '-T', service, 'cat', '/runtime/genesis-shelley.json'])
        if actual != genesis:
            raise RuntimeError('Producer genesis differs: ' + service)
    for service, internal, external in [('ogmios', '1337', '2637'), ('kupo', '1442', '2742')]:
        if command(compose + ['port', service, internal]) != '127.0.0.1:' + external:
            raise RuntimeError('Provider endpoint not owned by selected project')
    observed = control('inspect')[-1]
    if 'Moving' not in observed['registry']['phase']:
        raise RuntimeError('Rollback rehearsal requires an already-started migration')
    canonical_ref = f"{observed['outref']['txHash']}#{observed['outref']['outputIndex']}"
    before = registry('node')
    if canonical_ref not in before:
        raise RuntimeError('Provider registry disagrees with ledger')
    wait('all five ledgers contain the same registry', lambda: all(registry(s) == before for s in NODES))
    evidence['beforeRegistry'] = before
    evidence['beforeTips'] = {s: tip(s) for s in NODES}
    container = command(compose + ['ps', '-q', 'node'])
    inspect = json.loads(command(['docker', 'inspect', container]))[0]
    if inspect['Config']['Labels'].get('com.docker.compose.project') != project:
        raise RuntimeError('Primary container ownership mismatch')
    networks = inspect['NetworkSettings']['Networks']
    if len(networks) != 1:
        raise RuntimeError('Expected exactly one owned producer network')
    network, endpoint = next(iter(networks.items()))
    net = json.loads(command(['docker', 'network', 'inspect', network]))[0]
    if net['Labels'].get('com.docker.compose.project') != project:
        raise RuntimeError('Network ownership mismatch')
    reconnect = ['docker', 'network', 'connect', '--ip', endpoint['IPAddress'],
                 '--alias', 'node', network, container]
    detached = False
    try:
        command(['docker', 'network', 'disconnect', network, container])
        detached = True
        entries = control('resume', '--plan', str(plan), '--outbox', str(artifacts / f'v{generation}-outbox'),
                          '--submit', '--max-steps', '1')
        moves = [e for e in entries if e.get('action') in ['MoveCore', 'MoveTransferRoot', 'MoveEscrow']]
        if len(moves) != 1:
            raise RuntimeError('Expected one included minority migration move')
        minority = registry('node')
        if minority == before or canonical_ref in minority:
            raise RuntimeError('Minority ledger did not consume the source registry')
        minority_tip = tip('node')
        evidence.update(minorityMove=moves[0], minorityRegistry=minority, minorityTip=minority_tip)
        report.write_text(json.dumps(evidence, indent=2) + '\n')
        # Production validity lasts 300 slots. Waiting beyond the inclusion slot
        # plus 330 expires this transaction even if it is rebroadcast after healing.
        def majority_ahead():
            tips = [tip(s) for s in NODES[1:]]
            return (all(t['slot'] > minority_tip['slot'] + 330 for t in tips) and
                    min(t['block'] for t in tips) > tip('node')['block'] + 2)
        wait('four-producer branch outgrows minority after transaction expiry', majority_ahead)
        if any(registry(s) != before for s in NODES[1:]):
            raise RuntimeError('Unexpected competing migration on majority branch')
        evidence['majorityTipsBeforeHealing'] = {s: tip(s) for s in NODES[1:]}
    finally:
        if detached:
            command(reconnect)
        evidence['networkReconnected'] = True
        report.write_text(json.dumps(evidence, indent=2) + '\n')
    wait('minority rollback restores original registry on all five ledgers',
         lambda: all(registry(s) == before for s in NODES))
    wait('production provider follows canonical rollback',
         lambda: control('inspect')[-1]['outref'] == observed['outref'])
    evidence.update(status='rollback-observed', afterTips={s: tip(s) for s in NODES},
                    completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    resumeRequirement='Finish must use the same plan and outbox; canonical completion is checked separately')
    report.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'rollbackEvidence': str(report), 'status': evidence['status']}))


if __name__ == '__main__':
    main()
