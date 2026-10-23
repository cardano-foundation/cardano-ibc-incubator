#!/usr/bin/env python3
"""Run production services against the explicitly selected local upgrade fixture."""
import argparse
import hashlib
import json
import math
import os
import re
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'scripts/ci/aiken-contract-migration'


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['deploy', 'gateway', 'export-manifest', 'local-signers', 'setup-hermes', 'resume-hermes', 'hermes', 'cosmos', 'status', 'upgrade-plan', 'vote-upgrade', 'observe'])
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--hermes-binary', type=Path)
    parser.add_argument('--mithril-binary', type=Path)
    parser.add_argument('--upgrade-height', type=int)
    parser.add_argument('--upgrade-name', choices=['v8', 'v8.1'], default='v8.1')
    parser.add_argument('--out', type=Path)
    args, rest = parser.parse_known_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke'):
        parser.error('Expected an owned runtime under .deployment-smoke')
    profile = json.loads((runtime / 'upgrade-profile.json').read_text())
    if profile['runtime'] != str(runtime) or not profile['project'].startswith('cardano-deployment-test-'):
        parser.error('Runtime identity mismatch')
    genesis_bytes = (runtime / 'runtime/genesis-shelley.json').read_bytes()
    if hashlib.sha256(genesis_bytes).hexdigest() != profile['genesis_sha256']:
        parser.error('Cardano genesis differs from the recorded checkpoint')
    genesis = json.loads(genesis_bytes)
    ports = profile['ports']
    compose = ['docker', 'compose', '-p', profile['project'], '-f', str(runtime / 'compose.json')]
    bridge = runtime / profile.get('bridge_directory', 'bridge')
    database = profile.get('gateway_database', 'migration_upgrade_918')
    if not re.fullmatch(r'migration_upgrade_918(?:_[a-z0-9]+)?', database):
        parser.error('Expected an owned Gateway database name')
    handler = bridge / 'handler.json'
    logs = runtime / 'upgrade-logs'
    logs.mkdir(exist_ok=True)
    offset = profile['clock_offset_seconds']
    env = {key: value for key, value in os.environ.items() if key not in [
        'KUPO_API_KEY', 'OGMIOS_API_KEY', 'BRIDGE_MANIFEST_PATH', 'HANDLER_JSON_PATH', 'PGOPTIONS',
        'CARDANO_STABILITY_ASSUME_STATIC_STAKE', 'CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT',
        'CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE',
    ]}
    env.update({
        'PORT': str(ports['gateway_http']), 'GRPC_HOST': '127.0.0.1', 'GRPC_PORT': str(ports['gateway_grpc']),
        'CARDANO_NETWORK_MAGIC': '42', 'CARDANO_CHAIN_NETWORK_MAGIC': '42', 'CARDANO_CHAIN_ID': 'cardano-devnet',
        'CARDANO_CHAIN_HOST': '127.0.0.1', 'CARDANO_CHAIN_PORT': str(ports['devkit:3001']),
        'CARDANO_EPOCH_LENGTH': str(genesis['epochLength']), 'CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS': '604800',
        'CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS': '10',
        'CARDANO_RANDOMNESS_STABILISATION_WINDOW_SLOTS': str(math.ceil(4 * genesis['securityParam'] / genesis['activeSlotsCoeff'])),
        'CARDANO_LOCAL_EPOCH_SNAPSHOT_DIR': str(runtime / 'epoch-stake'),
        'CARDANO_EPOCH_NONCE_GENESIS': hashlib.blake2b(genesis_bytes, digest_size=32).hexdigest(),
        'CARDANO_EPOCH_PARAMS_ENDPOINT': f'http://127.0.0.1:{ports["nonce:8080"]}',
        'CARDANO_LOCAL_EPOCH_CONTEXT_ENDPOINT': f'http://127.0.0.1:{ports["nonce:8080"]}',
        'OGMIOS_ENDPOINT': f'http://127.0.0.1:{ports["devkit:1337"]}',
        'KUPO_ENDPOINT': f'http://127.0.0.1:{ports["devkit:1442"]}',
        'YACI_STORE_ENDPOINT': f'http://127.0.0.1:{ports["history:8080"]}',
        'GATEWAY_DB_HOST': '127.0.0.1', 'GATEWAY_DB_PORT': str(ports['gateway-db:5432']),
        'GATEWAY_DB_NAME': database, 'GATEWAY_DB_USERNAME': 'postgres', 'GATEWAY_DB_PASSWORD': 'postgres',
        'GATEWAY_DB_SYNCHRONIZE': 'true', 'HANDLER_JSON_PATH': str(handler),
        'CONSENSUS_HISTORY_CACHE_DIR': str(bridge / 'consensus-history'),
        'FAKETIME_DONT_FAKE_MONOTONIC': '1',
        'GATEWAY_DEBUG_DIAGNOSTICS': 'true', 'GATEWAY_DEBUG_DIAGNOSTICS_DIR': str(runtime / 'gateway-diagnostics'),
    })
    signer_url = runtime / 'mithril-local-url.txt'
    if signer_url.exists():
        env['MITHRIL_ENDPOINT'] = signer_url.read_text().splitlines()[0]

    def run(label, command, cwd=ROOT, input=None, clock=False):
        if clock:
            command = ['faketime', '-f', f'{offset:+d}s', *map(str, command)]
        log = logs / f'{time.time_ns()}-{label}.log'
        print(f'{label}: {log}', flush=True)
        with log.open('w') as output:
            response = subprocess.run(command, cwd=cwd, env=env, input=input, text=True,
                                      stdout=output, stderr=subprocess.STDOUT)
        stdout = log.read_text()
        print(stdout[-12000:], flush=True)
        if response.returncode:
            raise RuntimeError(f'{label} failed with code {response.returncode}. Reconcile any submitted transactions before retrying. Log: {log}')
        return stdout

    def json_http(url):
        with urllib.request.urlopen(url, timeout=20) as response:
            return json.load(response)

    def committed_tx(label, output):
        broadcast = json.loads(output)
        if broadcast.get('code', 0) or not re.fullmatch('[0-9A-Fa-f]{64}', broadcast.get('txhash', '')):
            raise RuntimeError(f'{label} was rejected: {broadcast}')
        txhash = broadcast['txhash']
        deadline = time.monotonic() + 90
        while True:
            try:
                receipt = json_http(f'http://127.0.0.1:{ports["cosmos_rpc"]}/tx?hash=0x{txhash}')
                result = receipt['result']
                if result['tx_result'].get('code', 0):
                    raise RuntimeError(f'{label} failed in the committed block: {result}')
                write(logs / f'{time.time_ns()}-{label}-committed.json', receipt)
                return result
            except (OSError, KeyError):
                if time.monotonic() > deadline:
                    raise RuntimeError(f'Reconcile {txhash} before retrying {label}')
                time.sleep(1)

    if args.command == 'status':
        result = {}
        for name, url in {
            'cardano': env['OGMIOS_ENDPOINT'] + '/health',
            'cosmos': f'http://127.0.0.1:{ports["cosmos_rpc"]}/status',
            'gateway': f'http://127.0.0.1:{ports["gateway_http"]}/health/ready',
        }.items():
            try:
                result[name] = json_http(url)
            except Exception as error:
                result[name] = {'error': str(error)}
        print(json.dumps(result, indent=2))
        return
    if args.command == 'deploy':
        run('deploy', ['python3', str(ROOT/'scripts/ci/test-cardano-migration-deployment.py'),
            '--compose', str(runtime/'compose.json'), '--project', profile['project'], '--existing-network',
            '--artifacts-dir', str(bridge), '--clock-offset-seconds', str(offset), '--migration-baseline'])
        return
    if args.command == 'local-signers':
        if not args.mithril_binary:
            parser.error('--mithril-binary must select the compiled local test signer server')
        run('capture-stake', ['python3', str(MIGRATION/'capture-migration-stake.py'),
            '--runtime', str(runtime), '--project', profile['project'], '--reuse-canonical-epoch'])
        tip = json.loads(run('tip', compose + ['exec', '-T', 'devkit', 'cardano-cli', 'conway', 'query', 'tip', '--testnet-magic', '42']))
        snapshot = json.loads((runtime / f'epoch-stake/{tip["epoch"]}.json').read_text())
        table = json.loads(subprocess.check_output(['node', str(Path(__file__).with_name('stake-table.cjs')),
            str(runtime/f'epoch-stake/{tip["epoch"]}.json')], text=True))
        request = {'epoch': snapshot['epoch'], 'stake_distribution': table,
                   'cache_file': str(runtime / 'mithril-local-certificates.json')}
        profile['mithril_source'] = {'kind': 'local-test-signers', 'stake_source': 'actual canonical ledger snapshot',
                                    'snapshot': snapshot, 'production_mithril_services_tested': False}
        write(runtime / 'upgrade-profile.json', profile)
        with signer_url.open('w') as output:
            child = subprocess.Popen([str(args.mithril_binary.resolve())], stdin=subprocess.PIPE, stdout=output)
            child.stdin.write(json.dumps(request).encode())
            child.stdin.close()
            try:
                child.wait()
            finally:
                if child.poll() is None:
                    child.terminate()
        return
    if not handler.is_file():
        parser.error('Deploy the fresh bridge first')
    if args.command == 'gateway':
        query = f"SELECT 1 FROM pg_database WHERE datname='{database}'"
        found = run('database-check', compose + ['exec', '-T', 'gateway-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query])
        if found.strip() != '1':
            run('create-database', compose + ['exec', '-T', 'gateway-db', 'createdb', '-U', 'postgres', database])
        os.chdir(ROOT / 'cardano/gateway')
        os.execvpe('faketime', ['faketime', '-f', f'{offset:+d}s', 'node', 'dist/main.js'], env)
    if args.command == 'export-manifest':
        run('export-manifest', ['node', 'dist/scripts/export-bridge-manifest.js', str(handler), str(bridge/'bridge-manifest.json')],
            cwd=ROOT/'cardano/gateway', clock=True)
        return
    if args.command == 'cosmos':
        if rest and rest[0] == '--':
            rest = rest[1:]
        run('cosmos', compose + ['exec', '-T', 'cosmos', 'simd', *rest])
        return
    if args.command == 'observe':
        if not args.out or not args.out.resolve().is_relative_to(runtime) or args.out.exists():
            parser.error('--out must select a new file inside this runtime')
        raw = subprocess.check_output(['node', str(Path(__file__).with_name('observe.cjs')), str(runtime)], text=True)
        observed = json.loads(raw)
        # Check every selected live protocol output against the actual ledger
        # as well as the indexer. A cached observation cannot stand in for this.
        refs = [f'{row["transaction_id"]}#{row["output_index"]}' for kind in ['clients', 'connections', 'channels', 'packet_lanes'] for row in observed[kind]]
        if refs:
            command = compose + ['exec', '-T', 'devkit', 'cardano-cli', 'conway', 'query', 'utxo', '--testnet-magic', '42', '--output-json']
            for ref in refs:
                command.extend(['--tx-in', ref])
            ledger = json.loads(run('observe-ledger', command))
            if set(ledger) != set(refs):
                raise RuntimeError('Indexer and actual ledger disagree about the protocol outputs')
            observed['ledger'] = ledger
        write(args.out, observed)
        print(f'Saved live observation: {args.out}')
        return
    if args.command == 'upgrade-plan':
        if not args.upgrade_height:
            parser.error('--upgrade-height must select a future source height')
        latest = int(json_http(f'http://127.0.0.1:{ports["cosmos_rpc"]}/status')['result']['sync_info']['latest_block_height'])
        if args.upgrade_height < latest + 30:
            parser.error('Leave at least thirty blocks for governance and inclusion')
        source = Path(__file__).with_name('live-client.go.tmpl').read_text()
        with tempfile.TemporaryDirectory(prefix='tendermint-upgrade-live-') as directory:
            source_path = Path(directory) / 'main.go'
            source_path.write_text(source)
            client_json = subprocess.check_output(['go', 'run', '-mod=readonly', str(source_path), profile['new_chain_id']],
                cwd=ROOT/'cosmos/cardano-probabilistic-light-client-v8',
                env=dict(env, GOTOOLCHAIN='go1.26.9', GOWORK='off'), text=True)
        write(runtime / 'upgraded-client.json', json.loads(client_json))
        # The supported simapp's existing v8 handler performs an ordinary SDK
        # module migration. The new revision is then an explicit export/import.
        # No verifier, commitment store or consensus check is patched.
        submitted = run('schedule-upgrade', compose + ['exec', '-T', 'cosmos', 'simd', 'tx', 'ibc', 'client',
            'schedule-ibc-upgrade', args.upgrade_name, str(args.upgrade_height), '/rehearsal/upgraded-client.json',
            '--title', 'Local Tendermint revision upgrade', '--summary', 'Disposable v8-classic-1 to v8-classic-2 rehearsal',
            '--deposit', '10000000stake', '--from', 'validator', '--home', '/var/lib/simd',
            '--keyring-backend', 'test', '--chain-id', profile['old_chain_id'], '--gas', '1000000',
            '--fees', '50000stake', '--yes', '--output', 'json'])
        receipt = committed_tx('schedule-upgrade', submitted)
        proposal_ids = {entry['value'] for event in receipt['tx_result']['events']
                        for entry in event['attributes'] if entry['key'] == 'proposal_id'}
        if len(proposal_ids) != 1:
            raise RuntimeError('Reconcile the committed proposal before voting')
        profile['upgrade_height'] = args.upgrade_height
        profile['upgrade_handler'] = args.upgrade_name
        profile['upgrade_proposal_id'] = proposal_ids.pop()
        profile['upgrade_proposal_tx'] = receipt['hash']
        write(runtime / 'upgrade-profile.json', profile)
        return
    if args.command == 'vote-upgrade':
        proposal = profile.get('upgrade_proposal_id', '')
        if not re.fullmatch('[1-9][0-9]*', proposal):
            parser.error('Schedule and confirm the upgrade proposal first')
        submitted = run('vote-upgrade', compose + ['exec', '-T', 'cosmos', 'simd', 'tx', 'gov', 'vote', proposal, 'yes',
            '--from', 'validator', '--home', '/var/lib/simd', '--keyring-backend', 'test', '--chain-id', profile['old_chain_id'],
            '--gas', '300000', '--fees', '50000stake', '--yes', '--output', 'json'])
        receipt = committed_tx('vote-upgrade', submitted)
        profile['upgrade_vote_tx'] = receipt['hash']
        write(runtime / 'upgrade-profile.json', profile)
        return
    if not args.hermes_binary:
        parser.error('--hermes-binary must select the relayer built from the pinned submodule')
    config_path = bridge / 'hermes.toml'
    hermes = [str(args.hermes_binary.resolve()), '--config', str(config_path)]
    if args.command == 'resume-hermes':
        if not profile.get('revision_restart_complete'):
            parser.error('Complete the verified revision restart first')
        backup = bridge / 'hermes-revision-1.toml'
        template = config_path.read_text()
        old = f"id = '{profile['old_chain_id']}'"
        new = f"id = '{profile['new_chain_id']}'"
        if backup.exists() or template.count(old) != 1:
            parser.error('Preserve the existing revision configuration before resuming')
        backup.write_text(template)
        backup.chmod(0o600)
        config_path.write_text(template.replace(old, new))
        settings = json.loads((runtime/'compose.json').read_text())['services']['cosmos']['environment']
        run('cosmos-revision-2-key', hermes + ['keys', 'add', '--chain', profile['new_chain_id'], '--mnemonic-file', '/dev/stdin'],
            input=settings['COSMOS_RELAYER_MNEMONIC'], clock=True)
        return
    if args.command == 'setup-hermes':
        if config_path.exists() or (bridge/'hermes-keys').exists():
            parser.error('Hermes is already initialized. Preserve its keys and configuration.')
        if not (bridge/'bridge-manifest.json').is_file():
            parser.error('Export the deployment manifest first')
        keys = bridge / 'hermes-keys'
        template = (ROOT / 'caribic/config/hermes-config.example.toml').read_text()
        for before, after in [
            ("enabled = true\nhost = '127.0.0.1'\nport = 3002", "enabled = false\nhost = '127.0.0.1'\nport = 3002"),
            ('http://localhost:5001', f'http://127.0.0.1:{ports["gateway_grpc"]}'),
            ('__CARDANO_BRIDGE_MANIFEST_PATH__', str(bridge/'bridge-manifest.json')),
            ('__CARDANO_SIGNING_KUPO_URL__', env['KUPO_ENDPOINT']),
            ('__CARDANO_SIGNING_OGMIOS_URL__', env['OGMIOS_ENDPOINT']),
            ("# key_store_folder = '/Users/yourusername/.hermes/keys'", f"key_store_folder = '{keys}'"),
            ("max_block_time = '20000ms'", "max_block_time = '40s'"),
            ('max_tx_size_bytes = 65536', 'max_tx_size_bytes = 16384'),
        ]:
            template = template.replace(before, after)
        template += f'''
[[chains]]
id = 'v8-classic-1'
type = 'CosmosSdk'
rpc_addr = 'http://127.0.0.1:{ports['cosmos_rpc']}'
grpc_addr = 'http://127.0.0.1:{ports['cosmos_grpc']}'
event_source = {{ mode = 'pull', interval = '500ms' }}
rpc_timeout = '30s'
trusted_node = true
account_prefix = 'cosmos'
key_name = 'upgrade-relayer'
key_store_type = 'Test'
key_store_folder = '{keys}'
address_type = {{ derivation = 'cosmos' }}
store_prefix = 'ibc'
default_gas = 5000000
max_gas = 600000000
gas_price = {{ price = 0.0025, denom = 'stake' }}
gas_multiplier = 1.8
max_msg_num = 20
max_tx_size = 8388608
clock_drift = '10s'
max_block_time = '10s'
trusting_period = '10days'
trust_threshold = {{ numerator = '1', denominator = '3' }}
compat_mode = '0.38'
'''
        config_path.write_text(template)
        config_path.chmod(0o600)
        defaults = {}
        for line in (ROOT/'cardano/offchain/.env.default').read_text().splitlines():
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                defaults[k] = v.strip().strip('"')
        fixture_key = next(value for value in defaults.values() if value.startswith('ed25519_sk'))
        entry = {'name': 'cardano-relayer', 'type': 'local', 'address': '', 'pubkey': '', 'network_id': 0, 'mnemonic': fixture_key}
        run('cardano-key', hermes + ['keys', 'add', '--chain', 'cardano-devnet', '--key-file', '/dev/stdin'],
            input=json.dumps(entry), clock=True)
        settings = json.loads((runtime/'compose.json').read_text())['services']['cosmos']['environment']
        run('cosmos-key', hermes + ['keys', 'add', '--chain', 'v8-classic-1', '--mnemonic-file', '/dev/stdin'],
            input=settings['COSMOS_RELAYER_MNEMONIC'], clock=True)
        return
    if args.command == 'hermes':
        if rest and rest[0] == '--':
            rest = rest[1:]
        run('hermes', [*hermes, '--json', *rest], clock=True)


if __name__ == '__main__':
    main()
