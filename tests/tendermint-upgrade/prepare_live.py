#!/usr/bin/env python3
"""Restore an isolated mature Cardano network for the Tendermint upgrade run."""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'scripts/ci/aiken-contract-migration'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, MIGRATION / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--project', default='cardano-deployment-test-918upgrade')
    parser.add_argument('--port-base', type=int, default=22600)
    parser.add_argument('--cosmos-image', default='local:cardano-ibc-918-cosmos-old')
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if runtime == ROOT / '.deployment-smoke' or not runtime.is_relative_to(ROOT / '.deployment-smoke'):
        parser.error('Expected a new owned runtime under .deployment-smoke')
    checkpoint = args.checkpoint.resolve()
    restore = load('upgrade_checkpoint', 'restore-migration-checkpoint.py')
    if not runtime.exists():
        restore.restore(checkpoint, runtime, args.project, ROOT / 'cardano/onchain/plutus.json', network_only=True)
    if (runtime / 'upgrade-profile.json').exists():
        parser.error('Runtime is already configured. Resume with its saved profile.')
    retained = json.loads((runtime / 'checkpoint-restore.json').read_text())
    if retained['project'] != args.project or retained['checkpoint'] != str(checkpoint):
        parser.error('The retained restore belongs to a different project or checkpoint')
    config = json.loads((runtime / 'compose.json').read_text())
    genesis = json.loads((runtime / 'runtime/genesis-shelley.json').read_text())
    state = json.loads((runtime / 'clock-state.json').read_text())
    point = state['steps'][-1]['tip']
    if genesis['networkMagic'] != 42 or point['slot'] < 20_000_000:
        parser.error('Expected genuine mature magic-42 history')
    start = datetime.datetime.fromisoformat(genesis['systemStart'].replace('Z', '+00:00')).timestamp()
    # Resume near the saved tip instead of jumping beyond the forecast window
    # when a checkpoint is restored several days after it was taken.
    offset = int(start + point['slot'] + 30 - time.time())
    if offset > 0:
        parser.error('The checkpoint must not be ahead of the host clock')
    mapping = {}
    reservations = []
    try:
        for service, settings in config['services'].items():
            if service == 'cosmos':
                continue
            for port in settings.get('ports', []):
                if not isinstance(port, dict):
                    parser.error('Expected normalized checkpoint port records')
                number = args.port_base + len(mapping) + 1
                key = f'{service}:{port["target"]}'
                mapping[key] = number
                port.update(host_ip='127.0.0.1', published=str(number))
        for name, delta in [('cosmos_rpc', 57), ('cosmos_grpc', 90), ('cosmos_rest', 17), ('gateway_http', 80), ('gateway_grpc', 81)]:
            mapping[name] = args.port_base + delta
        for number in mapping.values():
            reservation = socket.socket()
            reservation.bind(('127.0.0.1', number))
            reservations.append(reservation)
    finally:
        for reservation in reservations:
            reservation.close()
    (runtime / 'runtime/migration-clock.rc').write_text(f'{offset:+d}s\n')
    (runtime / '.caribic/devkit/clock-offset').write_text(f'{offset:+d}s')
    history_properties = runtime / 'yaci.properties'
    history_configuration = history_properties.read_text()
    if 'store.assets.enabled=false' in history_configuration:
        history_configuration = history_configuration.replace('store.assets.enabled=false', 'store.assets.enabled=true')
    elif 'store.assets.enabled=true' not in history_configuration:
        parser.error('The historical asset index must be explicitly enabled')
    history_properties.write_text(history_configuration)
    base = json.loads(subprocess.check_output([
        'docker', 'compose', '-f', str(ROOT / 'chains/cosmos/docker-compose.yml'),
        '--profile', 'v8-classic', 'config', '--format', 'json'], text=True))['services']['v8-classic']
    env = base['environment']
    env.update(COSMOS_CHAIN_ID='v8-classic-1', COSMOS_GOV_VOTING_PERIOD='30s',
               COSMOS_LOCAL_CLOCK_MODE='devkit', DEVKIT_CLOCK_OFFSET=f'{offset:+d}s',
               COSMOS_LOCAL_CARDANO_NETWORK_ID=hashlib.sha256((runtime / 'runtime/genesis-shelley.json').read_bytes()).hexdigest(),
               COSMOS_GENESIS_TIME=datetime.datetime.fromtimestamp(time.time()+offset-30, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
    config['services']['cosmos'] = {
        'image': args.cosmos_image, 'environment': env,
        'volumes': ['upgrade-cosmos-data:/var/lib/simd', f'{runtime}:/rehearsal'],
        'ports': [f'127.0.0.1:{mapping["cosmos_rpc"]}:26657', f'127.0.0.1:{mapping["cosmos_grpc"]}:9090', f'127.0.0.1:{mapping["cosmos_rest"]}:1317'],
        'healthcheck': base['healthcheck'],
    }
    config['volumes']['upgrade-cosmos-data'] = {'name': args.project + '_upgrade-cosmos-data'}
    write(runtime / 'compose.json', config)
    profile = {
        'format': 'tendermint-upgrade-live-v1', 'project': args.project, 'runtime': str(runtime),
        'checkpoint': str(checkpoint), 'checkpoint_sha256': retained['checkpointSha256'],
        'genesis_sha256': retained['genesisSha256'], 'restored_tip': point, 'clock_offset_seconds': offset,
        'ports': mapping, 'cosmos_image': args.cosmos_image, 'old_chain_id': 'v8-classic-1', 'new_chain_id': 'v8-classic-2',
        'successor_cosmos_image': 'local:cardano-ibc-918-cosmos',
        'mithril_mode': 'local-signers',
        'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'hermes_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT/'relayer', text=True).strip(),
        'scope': 'Isolated magic-42 Cardano ledger and local v8 Cosmos revision upgrade. No public-chain transactions.',
    }
    write(runtime / 'upgrade-profile.json', profile)
    print(json.dumps(profile, indent=2))


if __name__ == '__main__':
    main()
