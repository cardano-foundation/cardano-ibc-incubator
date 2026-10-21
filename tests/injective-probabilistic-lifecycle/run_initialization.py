#!/usr/bin/env python3
"""Replay actual Gateway creation responses as signed native Injective transactions."""
import argparse
import datetime
import hashlib
import json
import subprocess
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('responses', type=Path, help='CLIENT_INITIALIZATION_FIXTURE exported by the Gateway test')
parser.add_argument('output', type=Path, help='fresh evidence directory')
parser.add_argument('--image', default='local/injective-client-initialization')
args = parser.parse_args()
root = args.output.resolve()
root.mkdir(parents=True, exist_ok=False)
identity = 'cardano-initialization-' + uuid.uuid4().hex[:12]
volume, holder, server = identity + '-data', identity + '-prepare', identity + '-app'
repo = Path(__file__).resolve().parents[2]


def docker(*command, capture=True, **kwargs):
    result = subprocess.run(['docker', *map(str, command)], text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr or f'Docker command failed with status {result.returncode}')
    return result.stdout


def execute(*command, **kwargs):
    return docker('exec', holder, *command, **kwargs)


def save(name, data):
    path = root / name
    path.write_text(json.dumps(data, indent=2) + '\n')
    docker('cp', path, holder + ':/out/' + name)


def start():
    docker('run', '-d', '--name', server, '-v', volume + ':/out', args.image,
           'bounded-serve', '/out/testnet')
    for _ in range(120):
        if 'ABCI server ready' in docker('logs', server):
            return
        time.sleep(0.5)
    raise RuntimeError('Native Injective application did not start')


succeeded = False
try:
    docker('volume', 'create', volume)
    docker('run', '-d', '--name', holder, '-v', volume + ':/out', '--entrypoint', 'tail', args.image, '-f', '/dev/null')
    docker('cp', args.responses.resolve(), holder + ':/out/gateway-responses.json')
    execute('cardano-release-probe', 'initialization-info', '/out')
    docker('cp', holder + ':/out/initialization-info.json', root / 'initialization-info.json')
    info = json.loads((root / 'initialization-info.json').read_text())
    operator = execute('cardano-release-probe', 'address').strip()
    execute('cardano-release-probe', 'key', '/out/operator-key.hex')
    execute('injectived', 'init', identity, '--chain-id', 'injective-777', '--home', '/out/testnet')
    # This deterministic public fixture key is used only in the disposable local application.
    execute('sh', '-c', 'printf "local-test-only\\n" | injectived keys unsafe-import-eth-key operator "$(cat /out/operator-key.hex)" --keyring-backend test --home /out/testnet')
    execute('injectived', 'genesis', 'add-genesis-account', operator,
            '1000000000000000000000000000000inj,100000000000000000000stake',
            '--chain-id', 'injective-777', '--home', '/out/testnet')
    execute('injectived', 'genesis', 'gentx', 'operator', '50000000000000000000stake',
            '--chain-id', 'injective-777', '--keyring-backend', 'test', '--home', '/out/testnet')
    execute('injectived', 'genesis', 'collect-gentxs', '--home', '/out/testnet')
    genesis = json.loads(execute('cat', '/out/testnet/config/genesis.json'))
    stamp = info['checkpoint_unix_ns'] / 1_000_000_000 + 60
    genesis['genesis_time'] = datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
    evidence = Path(__file__).parent / 'evidence/network-snapshot'
    consensus = json.loads((evidence / 'consensus-params.json').read_text())['params']
    fees = json.loads((evidence / 'txfees-params.json').read_text())['params']
    genesis['consensus']['params']['block'] = consensus['block']
    genesis['app_state']['txfees']['params'] = fees
    ibc = genesis['app_state']['ibc']['client_genesis']
    if '*' not in ibc['params']['allowed_clients'] and '08-cardano-probabilistic' not in ibc['params']['allowed_clients']:
        ibc['params']['allowed_clients'].append('08-cardano-probabilistic')
    assert not ibc['clients'], 'creation must start without a genesis client'
    save('genesis.json', genesis)
    execute('cp', '/out/genesis.json', '/out/testnet/config/genesis.json')
    save('capacity-parameters.json', {'block': consensus['block'], 'txfees': fees})
    # Commit a partial import, restart the actual application, then resume the same client.
    start()
    docker('run', '--rm', '--network', 'container:' + server, '-v', volume + ':/out', args.image,
           'initialization-run', '/out', str(min(16, info['imports'] - 1)), capture=False)
    docker('cp', server + ':/out/initialization-result.json', root / 'before-restart.json')
    before = json.loads((root / 'before-restart.json').read_text())
    assert before['bootstrap_pending']
    docker('stop', server)
    docker('rm', server)
    start()
    docker('run', '--rm', '--network', 'container:' + server, '-v', volume + ':/out', args.image,
           'initialization-run', '/out', capture=False)
    docker('cp', holder + ':/out/.', root)
    result = json.loads((root / 'initialization-result.json').read_text())
    assert not result['bootstrap_pending'] and result['checkpoint_matches_gateway']
    assert result['application_restarted']
    transactions = json.loads((root / 'initialization-transactions.json').read_text())
    assert all(t['check_tx'].get('code', 0) == 0 and t['recheck_tx'].get('code', 0) == 0
               and t['execution'].get('code', 0) == 0 for t in transactions)
    result['gateway_responses_sha256'] = hashlib.sha256(args.responses.read_bytes()).hexdigest()
    result['native_probe_sha256'] = execute('sha256sum', '/usr/local/bin/cardano-release-probe').split()[0]
    result.update(initial_client_bytes=info['client_bytes'], initial_consensus_bytes=info['consensus_bytes'],
                  largest_signed_transaction=max(t['signed_bytes'] for t in transactions),
                  peak_execution_gas=max(int(t['execution']['gas_used']) for t in transactions),
                  peak_requested_gas=max(t['gas_wanted'] for t in transactions))
    result['source_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    (root / 'initialization-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    succeeded = True
finally:
    logs = subprocess.run(['docker', 'logs', server], text=True, capture_output=True)
    (root / 'node.log').write_text(logs.stdout + logs.stderr)
    if not succeeded:
        subprocess.run(['docker', 'cp', holder + ':/out/.', str(root)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for name in [server, holder]:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['docker', 'volume', 'rm', volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
