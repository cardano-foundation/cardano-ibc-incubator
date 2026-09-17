#!/usr/bin/env python3
"""Rehearse populated V1->V2->V3 using an owned, freshly deployed five-pool baseline.

Prerequisites: actual test-cardano-deployment.py --migration-baseline output,
compiled Gateway/Hermes, the disposable Cosmos clock image, and two reviewed
compiled successor fixtures. No mainnet, operator keys, synthetic IBC proofs or
modified approval delays are supported. Logs and rejected attempts are retained.
The production migration CLI owns recovery; this acceptance driver stops on any
ambiguous attempt. --from-stage permits an explicit continuation with existing
evidence; final verification rechecks every required packet receipt canonically.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
STAGES = ['bootstrap', 'populate', 'approve-v2', 'handover-v2', 'settle-v2',
          'approve-v3', 'handover-v3', 'settle-v3', 'verify-all']


def preflight_gateway_ports(ports=(8800, 5501)):
    for port in ports:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                raise RuntimeError(f'Gateway port {port} is occupied; stop that rehearsal process explicitly before handover')
        except ConnectionRefusedError:
            pass


def handover_transactions(receipt, generation, handler):
    if (receipt.get('format') != 'populated-migration-handover-v1' or
            receipt.get('generation') != generation or receipt.get('handler') != str(handler)):
        raise RuntimeError('Handover receipt does not describe the selected successor')
    transactions = receipt.get('transactions')
    if (not isinstance(transactions, list) or not transactions or
            any(not isinstance(tx, str) or not re.fullmatch('[0-9a-f]{64}', tx) for tx in transactions) or
            len(set(transactions)) != len(transactions)):
        raise RuntimeError('Handover receipt has an invalid transaction inventory')
    return transactions


def bind_handover_snapshots(before, approved, after, source, target, generation, genesis_sha):
    roles = ['hostStateStt', 'spendClient', 'spendConnection', 'spendChannel', 'spendTransferModule']
    unit = source['migration']['registryUnit']
    if (target['migration']['registryUnit'] != unit or source['hostStateNFT'] != target['hostStateNFT'] or
            int(source['migration']['generation']) != generation - 1 or
            int(target['migration']['generation']) != generation):
        raise RuntimeError('Selected handlers do not describe this bridge handover')
    for snapshot, handler, expected_generation in [(before, source, generation - 1),
                                                  (approved, source, generation - 1),
                                                  (after, target, generation)]:
        registry = snapshot['registry']
        if (snapshot['genesisSha256'] != genesis_sha or
                registry['token']['policy_id'] + registry['token']['name'] != unit or
                registry['host_policy'] != source['hostStateNFT']['policyId'] or
                int(registry['current']['generation']) != expected_generation):
            raise RuntimeError('Snapshot genesis, deployment or generation differs from selected handover')
        # This rehearsal's production planner creates enterprise script addresses.
        # Compare the full Plutus credential representation, including absent stake.
        addresses = [{'payment_credential': {'Script': [handler['validators'][role]['scriptHash']]},
                      'stake_credential': None} for role in roles]
        if (registry['current']['addresses'] != addresses or
                registry['current']['compatibility'] != handler['migration']['compatibility']):
            raise RuntimeError('Snapshot successor configuration differs from installed handler')


def bind_counterparty_continuity(generation, packet_row, activation):
    messages = packet_row.get('packetMessages', [])
    if (len(messages) != 1 or messages[0].get('packetMessageVerified') is not True or
            int(messages[0]['proofHeight']) < int(activation['inclusion']['block'])):
        raise RuntimeError('Old acknowledgement does not prove continuity at a post-activation root')
    return {'generation': generation, 'activationBlock': str(activation['inclusion']['block']), **messages[0]}


def counterparty_needs_update(state, accepted_height):
    client = state['client_state']
    height = client['latest_height']
    if (client['@type'] != '/ibc.lightclients.probabilistic.v1.ClientState' or
            int(height['revision_number']) != 0 or int(accepted_height) <= 0 or
            int(height['revision_height']) <= 0 or int(height['revision_height']) > int(accepted_height)):
        raise RuntimeError('Counterparty client differs from the accepted Cardano chain; reconcile before approval')
    return int(height['revision_height']) < int(accepted_height)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--artifacts-dir', type=Path, required=True)
    parser.add_argument('--v2-blueprint', type=Path, required=True)
    parser.add_argument('--v3-blueprint', type=Path, required=True)
    parser.add_argument('--history-schema', default='migration_rehearsal')
    parser.add_argument('--database-prefix', default='migration_rehearsal')
    parser.add_argument('--from-stage', choices=STAGES, default='bootstrap')
    parser.add_argument('--through-stage', choices=STAGES, default='verify-all')
    parser.add_argument('--retry-read-failure', metavar='STEP', help='Explicit one-step settlement retry after checking retained read-failure logs for construction/submission evidence; canonical pending state remains authoritative')
    args = parser.parse_args()
    runtime, artifacts = args.runtime.resolve(), args.artifacts_dir.resolve()
    if any(not p.is_relative_to(ROOT / '.deployment-smoke') or not p.is_dir() for p in [runtime, artifacts]):
        parser.error('Explicit owned disposable runtime and artifacts required')
    if any(not re.fullmatch('migration_[a-z0-9_]+', s) for s in [args.history_schema, args.database_prefix]):
        parser.error('Private database/schema names must begin migration_')
    baseline = json.loads((artifacts / 'result.json').read_text())
    if baseline['networkRuntime'] != str(runtime) or baseline['poolCount'] != 5:
        parser.error('Expected the actual five-pool deployment result')
    genesis_bytes = (runtime / 'runtime/genesis-shelley.json').read_bytes()
    genesis = json.loads(genesis_bytes)
    if genesis['networkMagic'] != 42 or genesis['epochLength'] != 432000 or genesis['slotLength'] != 1:
        parser.error('This rehearsal requires a fresh magic-42 five-day-epoch genesis')
    if not -63072000 <= baseline['clockOffsetSeconds'] <= -259200:
        parser.error('The fresh fixture needs at least three days of isolated clock headroom')
    if STAGES.index(args.from_stage) > STAGES.index(args.through_stage):
        parser.error('Stage interval is reversed')
    project = baseline['project']
    compose = ['docker', 'compose', '-p', project, '-f', str(runtime / 'compose.json')]
    genesis_sha = hashlib.sha256(genesis_bytes).hexdigest()
    run_dir = artifacts / ('rehearsal-' + uuid.uuid4().hex)
    run_dir.mkdir()
    children = {}
    opened_logs = []
    source = artifacts / 'handler.json'
    deno = ['deno', 'run', '-A', '--config', str(ROOT / 'cardano/offchain/deno.json'),
            '--import-map', str(artifacts / 'import-map.json')]
    channels = ['channel-0', 'channel-1']
    client = '08-cardano-probabilistic-0'
    selected = STAGES[STAGES.index(args.from_stage):STAGES.index(args.through_stage) + 1]

    def offset():
        state = runtime / 'clock-state.json'
        return json.loads(state.read_text())['offset'] if state.exists() else baseline['clockOffsetSeconds']

    def run(label, command, input_text=None):
        logfile = run_dir / f'{label}-{uuid.uuid4().hex}.log'
        print(json.dumps({'step': label, 'log': str(logfile)}), flush=True)
        with logfile.open('x') as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                    input=input_text, text=True)
        if result.returncode:
            raise RuntimeError(f'{label} failed; inspect {logfile}; retain all journals and chain data')
        return logfile.read_text()

    def runtime_command(command, handler, database=None, extra=()):
        return ['python3', str(ROOT / 'scripts/ci/migration-runtime.py'), command,
                '--runtime', str(runtime), '--project', project, '--clock-offset-seconds', str(offset()),
                '--handler', str(handler), '--history-schema', args.history_schema,
                '--gateway-database', database or args.database_prefix, *extra]

    def stop(name):
        process = children.pop(name, None)
        if process is None:
            return
        # Only process groups created by this driver; never discover/kill peers.
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=15)

    def start(name, command, env=None):
        stop(name)
        log = (run_dir / f'{name}-{uuid.uuid4().hex}.log').open('x')
        opened_logs.append(log)
        children[name] = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                          env=env, start_new_session=True)

    def stop_operational():
        stop('gateway')
        stop('history')

    def wait_http(ready):
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if children['gateway'].poll() is not None:
                raise RuntimeError('Owned Gateway exited; inspect its retained log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8800/health/ready', timeout=15) as response:
                    if not ready or json.load(response).get('status') == 'ready':
                        return
            except urllib.error.HTTPError as error:
                if not ready and error.code == 503:
                    return
            except (OSError, ValueError):
                pass
            time.sleep(2)
        raise RuntimeError('Gateway did not reach the required current/historical readiness')

    def history(handler):
        run('init-history', runtime_command('init-history', handler))
        start('history', runtime_command('history-sync', handler))

    def gateway(handler, historical=False):
        stop('gateway')
        preflight_gateway_ports()
        generation = json.loads(handler.read_text())['migration']['generation']
        database = args.database_prefix + ('_cold_' if historical else '_active_') + str(generation)
        if historical:
            # init-history preserves existing databases. An invocation-specific
            # name is required to demonstrate reconstruction from an empty cache.
            database += '_' + uuid.uuid4().hex[:12]
        run('init-gateway-cache', runtime_command('init-history', handler, database))
        env = dict(os.environ)
        if historical:
            env['GATEWAY_HISTORICAL_READ_ONLY'] = 'true'
        else:
            env.pop('GATEWAY_HISTORICAL_READ_ONLY', None)
        start('gateway', runtime_command('gateway', handler, database), env)
        wait_http(not historical)

    def hermes(operation):
        return ['python3', str(ROOT / 'scripts/ci/migration-hermes.py'), 'run', '--runtime', str(runtime),
                '--artifacts-dir', str(artifacts), '--clock-offset-seconds', str(offset()),
                '--wait-ready', '--', '--json', *operation]

    def traffic(phase, verify=False):
        output = run(phase + ('-verify' if verify else ''), ['python3', str(ROOT / 'scripts/ci/migration-rehearsal-traffic.py'),
            '--runtime', str(runtime), '--artifacts-dir', str(artifacts), '--clock-offset-seconds', str(offset()),
            '--cosmos-channels', *channels, '--phase', phase, *(['--verify-only'] if verify else []),
            *(['--retry-read-failure', args.retry_read_failure] if args.retry_read_failure and not verify else [])])
        if not verify: args.retry_read_failure = None
        return output

    def control(handler, command):
        return ['python3', str(ROOT / 'scripts/ci/migration-control.py'), '--runtime', str(runtime),
                '--artifacts-dir', str(artifacts), '--handler', str(handler), '--', *command]

    def capture(handler, name):
        run(name, deno + [str(ROOT / 'scripts/ci/capture-migration-population.ts'), str(runtime),
                         str(handler), str(artifacts / (name + '.json'))])

    def balances(handler, snapshot, phase, generation):
        run('balances-' + phase, ['python3', str(ROOT / 'scripts/ci/verify-migration-traffic-balances.py'),
            '--handler', str(handler), '--snapshot', str(artifacts / (snapshot + '.json')),
            '--wallet-population', str(runtime / 'wallet-population.json'), '--phase', phase,
            '--generation', str(generation), '--genesis-sha256', genesis_sha, '--cosmos-channels', *channels])

    def installed(generation):
        return source if generation == 1 else artifacts / f'handler-v{generation}.json'

    def ensure_active(generation):
        handler = installed(generation)
        if 'gateway' not in children:
            history(handler)
            gateway(handler)
        return handler

    try:
        for stage in selected:
            print(json.dumps({'stage': stage, 'offset': offset()}), flush=True)
            if stage == 'bootstrap':
                if (artifacts / 'hermes.toml').exists():
                    raise RuntimeError('Bootstrap requires a fresh bridge; do not recreate existing clients/routes')
                run('services', runtime_command('services', source))
                # Wait for real Yaci schema and at least block one; genesis replay
                # is performed before any later epoch nonce can be indexed.
                deadline = time.monotonic() + 600
                while time.monotonic() < deadline:
                    query = subprocess.run(compose + ['exec', '-T', 'history-db', 'psql', '-U', 'postgres',
                        '-d', 'migration_yaci', '-Atc', 'SELECT count(*) FROM block WHERE number=1'],
                        capture_output=True, text=True)
                    if query.returncode == 0 and query.stdout.strip() == '1': break
                    time.sleep(2)
                else: raise RuntimeError('Yaci did not index the fresh canonical chain')
                run('genesis-history', ['node', str(ROOT / 'scripts/ci/migration-genesis-history.cjs'), str(runtime)])
                run('stake', ['python3', str(ROOT / 'scripts/ci/capture-migration-stake.py'),
                              '--runtime', str(runtime), '--project', project])
                history(source)
                gateway(source)
                run('manifest-v1', runtime_command('export', source))
                run('hermes-setup', ['python3', str(ROOT / 'scripts/ci/migration-hermes.py'), 'setup',
                    '--runtime', str(runtime), '--artifacts-dir', str(artifacts), '--clock-offset-seconds', str(offset())])
                run('wallet-population', deno + [str(ROOT / 'scripts/ci/migration-wallet.ts'), str(runtime)])
                run('connection', hermes(['create', 'connection', '--a-chain', 'cardano-devnet', '--b-chain', 'migration-462-1']))
                for index in range(2):
                    run('channel-' + str(index), hermes(['create', 'channel', '--a-chain', 'cardano-devnet',
                        '--a-connection', 'connection-0', '--a-port', 'transfer', '--b-port', 'transfer',
                        '--order', 'unordered', '--channel-version', 'ics20-1']))
            elif stage == 'populate':
                ensure_active(1)
                traffic('populate')
            elif stage.startswith('approve-'):
                generation = int(stage[-1])
                handler = ensure_active(generation - 1)
                plan = artifacts / f'migration-v{generation}-populated.json'
                outbox = artifacts / f'v{generation}-outbox'
                accepted = json.loads(run('accepted-cardano-height',
                    ['node', str(ROOT / 'scripts/ci/verify-migration-packet.cjs')],
                    input_text=json.dumps({'manifest': str(artifacts / 'hermes-bridge-manifest.json'),
                                           'channel': 'channel-0', 'mode': 'chain-time'})).splitlines()[-1])
                with urllib.request.urlopen('http://127.0.0.1:1527/ibc/core/client/v1/client_states/' + client) as response:
                    state = json.load(response)
                if counterparty_needs_update(state, accepted['height']):
                    run('counterparty-catch-up', hermes(['update', 'client', '--host-chain', 'migration-462-1', '--client', client]))
                    with urllib.request.urlopen('http://127.0.0.1:1527/ibc/core/client/v1/client_states/' + client) as response:
                        state = json.load(response)
                    if int(state['client_state']['latest_height']['revision_height']) < int(accepted['height']):
                        raise RuntimeError('Counterparty update did not reach the accepted Cardano height')
                # Require a retained IBC root and actual historical proof access
                # before approving, including when no update was necessary.
                run('counterparty-anchor', ['node', str(ROOT / 'scripts/ci/capture-migration-historical-proof.cjs'),
                    str(runtime), str(handler), client, state['client_state']['latest_height']['revision_height'],
                    'channel-0', '1', str(artifacts / f'counterparty-pre-v{generation}-proof.json')])
                with (artifacts / f'counterparty-pre-v{generation}-client-state.json').open('x') as output:
                    json.dump(state, output, indent=2)
                run('prepare', control(handler, ['prepare', '--blueprint', str(
                    args.v2_blueprint.resolve() if generation == 2 else args.v3_blueprint.resolve()), '--out', str(plan)]))
                run('publish', control(handler, ['publish', '--plan', str(plan), '--outbox', str(outbox), '--submit']))
                capture(handler, f'population-before-v{generation}')
                balances(handler, f'population-before-v{generation}', 'populated' if generation == 2 else 'settled', generation - 1)
                run('witness', runtime_command('witness', handler, extra=['--out', str(artifacts / f'activation-v{generation}-witness.json')]))
                tip = json.loads(subprocess.check_output(compose + ['exec', '-T', 'node', 'cardano-cli',
                    'conway', 'query', 'tip', '--testnet-magic', '42']))
                start = int(datetime.datetime.fromisoformat(genesis['systemStart'].replace('Z', '+00:00')).timestamp() * 1000)
                expiry = start + tip['slot'] * 1000 + 259200000
                authority = json.loads((artifacts / 'migration-governance.json').read_text())
                if authority != {'signers': ['8f310f79f977bdf0befedfae3374a625e64c9a69a40c3c8fca607dac'],
                                  'quorum': '1', 'delay_ms': '86400000'}:
                    raise RuntimeError('Only the explicitly configured public rehearsal authority is supported')
                run('authorize', control(handler, ['authorize', '--plan', str(plan), '--signers', authority['signers'][0],
                    '--expires-at', str(expiry), '--outbox', str(outbox), '--submit']))
                capture(handler, f'population-approved-v{generation}')
                observed = json.loads(run('inspect-approved', control(handler, ['inspect'])).splitlines()[-1])
                stop_operational()
                ready = int(observed['registry']['phase']['Proposed']['ready_at']) + 120000
                run('approval-delay', ['python3', str(ROOT / 'scripts/ci/advance-migration-clock.py'),
                    '--runtime', str(runtime), '--project', project, '--file-clock', '--until-ms', str(ready)])
            elif stage.startswith('handover-'):
                generation = int(stage[-1])
                handler = installed(generation - 1)
                stop_operational()
                preflight_gateway_ports()
                history(handler)
                handover = ['python3', str(ROOT / 'scripts/ci/rehearse-migration-handover.py'),
                    '--runtime', str(runtime), '--artifacts-dir', str(artifacts), '--handler', str(handler),
                    '--plan', str(artifacts / f'migration-v{generation}-populated.json'), '--generation', str(generation)]
                run('begin-' + str(generation), handover + ['begin'])
                gateway(handler, historical=True)
                accepted = json.loads((artifacts / f'counterparty-pre-v{generation}-client-state.json').read_text())
                height = accepted['client_state']['latest_height']['revision_height']
                run('cold-history', ['node', str(ROOT / 'scripts/ci/capture-migration-historical-proof.cjs'),
                    str(runtime), str(handler), client, str(height), 'channel-0', '1',
                    str(artifacts / f'cold-moving-v{generation}-proof.json')])
                run('paused-rpc', ['node', str(ROOT / 'scripts/ci/verify-migration-paused-rpc.cjs'),
                    str(artifacts / f'cold-moving-v{generation}-rejections.json')])
                stop('gateway')
                run('finish-' + str(generation), handover + ['finish'])
                stop('history')
                target = installed(generation)
                history(target)
                run('manifest-' + str(generation), runtime_command('export', target))
                run('install-' + str(generation), ['python3', str(ROOT / 'scripts/ci/migration-hermes.py'),
                    'install-manifest', '--runtime', str(runtime), '--artifacts-dir', str(artifacts),
                    '--clock-offset-seconds', str(offset()), '--generation', str(generation)])
                gateway(target)
            elif stage.startswith('settle-'):
                generation = int(stage[-1])
                handler = ensure_active(generation)
                traffic(stage)
                capture(handler, f'population-settled-v{generation}')
                balances(handler, f'population-settled-v{generation}', 'settled' if generation == 2 else 'settled-v3', generation)
            elif stage == 'verify-all':
                ensure_active(3)
                packet_rows, continuity = {}, []
                for phase in ['populate', 'settle-v2', 'settle-v3']:
                    for line in traffic(phase, verify=True).splitlines():
                        try: row = json.loads(line)
                        except ValueError: continue
                        if row.get('canonicalReceiptReused') is True:
                            packet_rows[row['step']] = row
                for generation in [2, 3]:
                    read = lambda path: json.loads(path.read_text())
                    bind_handover_snapshots(
                        read(artifacts / f'population-before-v{generation}.json'),
                        read(artifacts / f'population-approved-v{generation}.json'),
                        read(artifacts / f'population-after-v{generation}.json'),
                        read(installed(generation - 1)), read(installed(generation)), generation, genesis_sha)
                    run('verify-conservation', deno + [str(ROOT / 'scripts/ci/verify-migration-population.ts'),
                        str(artifacts / f'population-before-v{generation}.json'),
                        str(artifacts / f'population-after-v{generation}.json'),
                        str(artifacts / f'activation-v{generation}-witness.json')])
                    evidence = artifacts / f'v{generation}-handover/result.json'
                    receipt = json.loads(evidence.read_text())
                    reports = []
                    for transaction in handover_transactions(receipt, generation, installed(generation)):
                        report = run_dir / f'v{generation}-{transaction}.measurement.json'
                        run('recheck-handover-transaction', ['node', str(ROOT / 'scripts/ci/measure-migration-transaction.cjs'),
                            str(runtime), transaction, str(report)])
                        reports.append(str(report))
                    # Recompute accounting from canonically remeasured bodies,
                    # bound to this handover's approved and activated snapshots.
                    funding = json.loads(run('recheck-handover-funding', ['python3',
                        str(ROOT / 'scripts/ci/verify-migration-funding.py'),
                        str(artifacts / f'population-approved-v{generation}.json'),
                        str(artifacts / f'population-after-v{generation}.json'), *reports]).splitlines()[-1])
                    if funding != receipt.get('funding'):
                        raise RuntimeError('Recomputed funding differs from the handover receipt')
                    activated_tx = read(artifacts / f'population-after-v{generation}.json')['registryUtxo']['txHash']
                    activation = next(read(Path(report)) for report in reports if read(Path(report))['transaction'] == activated_tx)
                    # These are old foreign-origin obligations acknowledged on
                    # the original route after each respective activation.
                    step = 'foreign-primary-ack' if generation == 2 else 'foreign-pending-ack'
                    continuity.append(bind_counterparty_continuity(generation, packet_rows[step], activation))
                balances(installed(3), 'population-settled-v3', 'settled-v3', 3)
                with (run_dir / 'result.json').open('x') as output:
                    json.dump({'format': 'populated-migration-rehearsal-v1', 'genesisSha256': genesis_sha,
                        'deployment': json.loads(source.read_text())['migration']['registryUnit'],
                        'stagesExecuted': selected, 'allPacketReceiptsCanonicallyRechecked': True,
                        'counterpartyContinuity': continuity,
                        'scope': 'Owned two-chain rehearsal and independent accounting, not a public-network finality certificate or independent audit'},
                        output, indent=2)
        print(json.dumps({'completedStages': selected, 'evidence': str(run_dir)}))
    finally:
        for name in list(children): stop(name)
        for log in opened_logs: log.close()


if __name__ == '__main__':
    main()
