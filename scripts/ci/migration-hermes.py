#!/usr/bin/env python3
"""Configure/run Hermes with only disposable migration-rehearsal keys and endpoints."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['setup', 'run', 'heartbeat', 'install-manifest'])
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--clock-offset-seconds', type=int, required=True)
    p.add_argument('--generation', type=int, default=1)
    p.add_argument('--wait-ready', action='store_true', help='Wait for current-root proof readiness before starting one command; never retries a submitted transaction')
    p.add_argument('--artifacts-dir', type=Path, help='Separate bridge baseline artifacts/config/keys on the selected disposable network')
    args, rest = p.parse_known_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke') or not (runtime / 'compose.json').is_file():
        p.error('Expected an explicitly selected disposable migration runtime')
    if not -63072000 <= args.clock_offset_seconds <= 0: p.error('Invalid disposable clock offset')
    hermes = ROOT / 'relayer/target/debug/hermes'
    artifacts = args.artifacts_dir.resolve() if args.artifacts_dir else runtime
    if not artifacts.is_relative_to(ROOT / '.deployment-smoke') or not artifacts.is_dir():
        p.error('Expected existing disposable bridge artifacts')
    config = artifacts / 'hermes.toml'
    keys = artifacts / 'hermes-keys'
    snapshot = artifacts / 'hermes-bridge-manifest.json'
    env = dict(os.environ, FAKETIME_DONT_FAKE_MONOTONIC='1')
    command = ['faketime', '-f', f'{args.clock_offset_seconds:+d}s', str(hermes), '--config', str(config)]
    if args.command in ['setup', 'install-manifest']:
        source = artifacts / f'bridge-manifest-{args.generation}.json'
        manifest = json.loads(source.read_text())
        if manifest['cardano']['network_magic'] != 42: p.error('Refusing a non-rehearsal manifest')
        if args.command == 'setup' and (config.exists() or keys.exists()):
            p.error('Hermes runtime already configured; do not overwrite test keys or manifest')
        if args.command == 'install-manifest':
            if not snapshot.is_file(): p.error('Run setup before installing a successor manifest')
            previous = json.loads(snapshot.read_text())
            if previous['deployment_id'] != manifest['deployment_id'] or previous['host_state_nft'] != manifest['host_state_nft']:
                p.error('Successor manifest must preserve this bridge identity; configure a separate artifact directory for a fresh baseline')
        snapshot.write_bytes(source.read_bytes()); snapshot.chmod(0o600)
        if args.command == 'install-manifest': return
        if config.exists() or keys.exists(): p.error('Hermes runtime already configured; do not overwrite test keys')
        template = (ROOT / 'caribic/config/hermes-config.example.toml').read_text()
        template = template.replace('enabled = true\nhost = \'127.0.0.1\'\nport = 3002', 'enabled = false\nhost = \'127.0.0.1\'\nport = 3002')
        for old, new in [('http://localhost:5001', 'http://127.0.0.1:5501'),
                         ('__CARDANO_BRIDGE_MANIFEST_PATH__', str(snapshot)),
                         ('__CARDANO_SIGNING_KUPO_URL__', 'http://127.0.0.1:2742'),
                         ('__CARDANO_SIGNING_OGMIOS_URL__', 'http://127.0.0.1:2637'),
                         ("# key_store_folder = '/Users/yourusername/.hermes/keys'", f"key_store_folder = '{keys}'"),
                         ("max_block_time = '20000ms'", "max_block_time = '40s'"),
                         ("clock_drift = '5s'", "clock_drift = '10s'"),
                         ('max_tx_size_bytes = 65536', 'max_tx_size_bytes = 16384')]:
            template = template.replace(old, new)
        template += f'''
[[chains]]
id = 'migration-462-1'
type = 'CosmosSdk'
rpc_addr = 'http://127.0.0.1:28757'
grpc_addr = 'http://127.0.0.1:9300'
event_source = {{ mode = 'push', url = 'ws://127.0.0.1:28757/websocket', batch_delay = '200ms' }}
rpc_timeout = '20s'
trusted_node = true
account_prefix = 'cosmos'
key_name = 'migration-relayer'
key_store_type = 'Test'
key_store_folder = '{keys}'
address_type = {{ derivation = 'cosmos' }}
store_prefix = 'ibc'
default_gas = 5000000
max_gas = 75000000
gas_price = {{ price = 0.0025, denom = 'stake' }}
gas_multiplier = 1.8
max_msg_num = 20
max_tx_size = 1000000
clock_drift = '10s'
max_block_time = '10s'
trusting_period = '10days'
trust_threshold = {{ numerator = '1', denominator = '3' }}
compat_mode = '0.38'
'''
        config.write_text(template)
        # Public, checked-in local-devnet material. Never read a user's Hermes home.
        defaults = {}
        for line in (ROOT / 'cardano/offchain/.env.default').read_text().splitlines():
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1); defaults[key] = value.strip().strip('"')
        key = next(value for value in defaults.values() if value.startswith('ed25519_sk'))
        cardano_key = {'name': 'cardano-relayer', 'type': 'local', 'address': '', 'pubkey': '', 'network_id': 0, 'mnemonic': key}
        subprocess.run(command + ['keys', 'add', '--chain', 'cardano-devnet', '--key-file', '/dev/stdin'], input=json.dumps(cardano_key), text=True, env=env, check=True)
        cosmos = json.loads((runtime / 'compose.json').read_text())['services']['cosmos']['environment']
        subprocess.run(command + ['keys', 'add', '--chain', 'migration-462-1', '--mnemonic-file', '/dev/stdin'], input=cosmos['COSMOS_RELAYER_MNEMONIC'], text=True, env=env, check=True)
    else:
        if not config.is_file(): p.error('Run setup with a verified manifest first')
        if args.command == 'heartbeat':
            # Same guarded endpoint as the proactive worker; do not start
            # packet workers and settle the deliberately pending obligations.
            subprocess.run(command + ['--json', 'tx', 'host-state-heartbeat', '--chain', 'cardano-devnet'], env=env, check=True)
            return
        if rest and rest[0] == '--': rest = rest[1:]
        if not rest: p.error('Supply an explicit Hermes command after --')
        if args.wait_ready:
            import time
            import urllib.request
            import urllib.error
            deadline = time.monotonic() + 600
            while True:
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8800/health/ready', timeout=30) as response:
                        if json.load(response).get('status') == 'ready': break
                except (OSError, ValueError): pass
                if time.monotonic() >= deadline:
                    raise RuntimeError('Gateway did not become proof-ready; no command was submitted. Inspect stability, epoch heartbeat, migration phase, and canonical history.')
                time.sleep(2)
        subprocess.run(command + rest, env=env, check=True)

if __name__ == '__main__': main()
