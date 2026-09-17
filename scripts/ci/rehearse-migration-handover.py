#!/usr/bin/env python3
"""Execute and independently account for one approved populated devnet handover.

Run begin and finish in separate processes to exercise the interruption boundary.
This calls production transaction builders and the real node. It never approves
code, changes a clock, starts packet workers or infers completion from a journal.
Gateway must be quiescent; install/export the verified handler before settlement.
"""
import argparse
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['begin', 'finish'])
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--artifacts-dir', type=Path, required=True)
    parser.add_argument('--handler', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--generation', type=int, choices=[2, 3], required=True)
    args = parser.parse_args()
    runtime, artifacts, handler, plan = [p.resolve() for p in
                                         [args.runtime, args.artifacts_dir, args.handler, args.plan]]
    for path in [runtime, artifacts, handler, plan]:
        if not path.is_relative_to(ROOT / '.deployment-smoke') or not path.exists():
            parser.error('Explicit existing disposable artifacts are required')
    result = json.loads((runtime / 'result.json').read_text())
    if result['networkRuntime'] != str(runtime):
        parser.error('Deployment result belongs to another runtime')
    source = json.loads(handler.read_text())
    if int(source['migration']['generation']) != args.generation - 1:
        parser.error('Source handler is not the preceding generation')
    prefix = f'v{args.generation}'
    evidence = artifacts / f'{prefix}-handover'
    evidence.mkdir(exist_ok=True)
    control = ['python3', str(ROOT / 'scripts/ci/migration-control.py'), '--runtime', str(runtime),
               '--artifacts-dir', str(artifacts), '--handler', str(handler), '--executor', 'migration', '--']
    deno = ['deno', 'run', '-A', '--config', str(ROOT / 'cardano/offchain/deno.json'),
            '--import-map', str(artifacts / 'import-map.json')]

    def run(name, command):
        log = evidence / f'{name}-{uuid.uuid4().hex}.log'
        print(json.dumps({'step': name, 'log': str(log)}), flush=True)
        with log.open('x') as output:
            completed = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
        if completed.returncode:
            raise RuntimeError(f'{name} failed; retain journals and inspect canonical state and {log}')
        return log.read_text()

    def inspect():
        text = run('inspect', control + ['inspect'])
        return json.loads(text.splitlines()[-1])['registry']

    def capture(selected_handler, output):
        return run('capture', deno + [str(ROOT / 'scripts/ci/capture-migration-population.ts'),
                                     str(runtime), str(selected_handler), str(output)])

    registry = inspect()
    if registry['token']['policy_id'] + registry['token']['name'] != source['migration']['registryUnit']:
        raise RuntimeError('Observed registry belongs to another bridge')
    generation = int(registry['current']['generation'])
    phase = registry['phase']
    witness = artifacts / f'activation-{prefix}-witness.json'
    outbox = artifacts / f'{prefix}-outbox'
    options = ['--plan', str(plan), '--outbox', str(outbox), '--submit']
    if args.phase == 'begin':
        if generation != args.generation - 1 or not isinstance(phase, dict) or 'Proposed' not in phase:
            raise RuntimeError('Begin requires the canonical approved source generation')
        # On-chain and production CLI checks enforce maturity and the exact plan.
        run('begin', control + ['execute', *options, '--max-steps', '1'])
        observed = inspect()
        if not isinstance(observed['phase'], dict) or 'Moving' not in observed['phase']:
            raise RuntimeError('Begin did not establish the canonical migration boundary')
        capture(handler, artifacts / f'population-moving-{prefix}.json')
        print(json.dumps({'generation': args.generation, 'phase': 'Moving',
                          'instruction': 'Process exits here. Inspect the paused bridge, then invoke finish separately.'}))
        return

    if generation == args.generation - 1 and isinstance(phase, dict) and 'Moving' in phase:
        run('resume', control + ['resume', *options, '--max-steps', '20', '--port-witness', str(witness)])
    elif not (generation == args.generation and phase == 'Ready'):
        raise RuntimeError('Finish requires canonical Moving or the already activated target')
    target = artifacts / f'handler-{prefix}.json'
    if target.exists():
        raise RuntimeError('Verified target handler already exists; retain it and reconcile later evidence explicitly')
    run('verify', control + ['verify', '--plan', str(plan), '--out', str(target)])
    after = artifacts / f'population-after-{prefix}.json'
    capture(target, after)
    run('conservation', deno + [str(ROOT / 'scripts/ci/verify-migration-population.ts'),
                               str(artifacts / f'population-before-{prefix}.json'), str(after), str(witness)])
    transactions = set()
    for log in [*evidence.glob('begin-*.log'), *evidence.glob('resume-*.log')]:
        for line in log.read_text().splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get('action') in ['Begin', 'MoveCore', 'MoveTransferRoot', 'MoveEscrow', 'Activate']:
                transactions.add(entry['transaction'])
    reports = []
    for transaction in sorted(transactions):
        report = evidence / f'{transaction}.measurement.json'
        # A previous measurement is not canonical progress evidence. Recheck
        # current inclusion into a new file, preserving every older observation.
        if report.exists():
            report = evidence / f'{transaction}.{uuid.uuid4().hex}.measurement.json'
        run('measure', ['node', str(ROOT / 'scripts/ci/measure-migration-transaction.cjs'),
                        str(runtime), transaction, str(report)])
        reports.append(str(report))
    funding = run('funding', ['python3', str(ROOT / 'scripts/ci/verify-migration-funding.py'),
                              str(artifacts / f'population-approved-{prefix}.json'), str(after), *reports])
    receipt = {'format': 'populated-migration-handover-v1', 'generation': args.generation,
               'handler': str(target), 'transactions': sorted(transactions),
               'funding': json.loads(funding.splitlines()[-1]),
               'scope': 'Canonical local custody and conservation; post-activation packet settlement is separate'}
    with (evidence / 'result.json').open('x') as output:
        json.dump(receipt, output, indent=2)
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
