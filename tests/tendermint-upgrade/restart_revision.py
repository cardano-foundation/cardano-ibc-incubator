#!/usr/bin/env python3
"""Restart the owned Cosmos chain in revision two after the Cardano upgrade."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke'):
        parser.error('Only the explicitly owned disposable runtime is supported')
    profile = json.loads((runtime / 'upgrade-profile.json').read_text())
    if profile['runtime'] != str(runtime) or not profile['project'].startswith('cardano-deployment-test-'):
        parser.error('Runtime identity mismatch')
    revision = runtime / 'revision-2'
    if revision.exists():
        parser.error('A revision restart already exists. Inspect its retained stage before resuming.')
    observation = runtime / f'pre-restart-{time.time_ns()}.json'
    subprocess.run(['python3', str(Path(__file__).with_name('live.py')), 'observe', '--runtime', str(runtime), '--out', str(observation)], check=True)
    before = json.loads(observation.read_text())
    if len(before['clients']) != 1:
        parser.error('The rehearsal expects exactly one Cardano Tendermint client')
    datum = before['clients'][0]['decoded']
    client = datum['state']['clientState']
    if (bytes.fromhex(client['chainId']).decode() != profile['new_chain_id'] or
            client['latestHeight'] != {'revisionNumber': '2', 'revisionHeight': '1'}):
        parser.error('Commit the actual Cardano client upgrade before restarting Cosmos')
    states = datum['state']['consensusStates']
    if len(states) != 1 or bytes.fromhex(states[0][1]['root']['hash']) != b'sentinel_root':
        parser.error('Expected the actual on-ledger upgrade bootstrap state')
    revision.mkdir(mode=0o700)
    compose_file = runtime / 'compose.json'
    config = json.loads(compose_file.read_text())
    write(revision / 'compose-before.json', config)
    compose = ['docker', 'compose', '-p', profile['project'], '-f', str(compose_file)]
    log = (revision / 'restart.log').open('a')

    def run(*command):
        response = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        log.flush()
        if response.returncode:
            raise RuntimeError('Restart step failed. Preserve both homes and inspect ' + str(revision / 'restart.log'))

    def rpc(method):
        with urllib.request.urlopen(f'http://127.0.0.1:{profile["ports"]["cosmos_rpc"]}/{method}', timeout=10) as response:
            return json.load(response)['result']

    old_status = rpc('status')
    if old_status['node_info']['network'] != profile['old_chain_id']:
        parser.error('The selected RPC is not the old Cosmos revision')
    old_block = rpc('block')
    write(revision / 'old-status.json', old_status)
    write(revision / 'old-block.json', old_block)
    halt_height = profile['upgrade_height']
    old_application = rpc('abci_info')['response']
    if int(old_application['last_block_height']) != halt_height - 1:
        raise RuntimeError('Expected the old application at its actual SDK upgrade halt')
    run(*compose, 'stop', 'cosmos')
    # First restart the same chain with the binary containing its scheduled
    # handler. Let the real SDK apply the upgrade before exporting for the
    # revision reset. This keeps the old signing journal throughout chain one.
    config['services']['cosmos']['image'] = profile['successor_cosmos_image']
    write(compose_file, config)
    run(*compose, 'up', '-d', 'cosmos')
    deadline = time.monotonic() + 180
    while True:
        try:
            migration_status = rpc('status')
            application = rpc('abci_info')['response']
            if (migration_status['node_info']['network'] == profile['old_chain_id'] and
                    int(application['last_block_height']) >= halt_height + 1):
                break
        except (OSError, KeyError, ValueError):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('The successor did not apply the scheduled SDK upgrade')
        time.sleep(1)
    with urllib.request.urlopen(f'http://127.0.0.1:{profile["ports"]["cosmos_rest"]}/cosmos/upgrade/v1beta1/applied_plan/{profile["upgrade_handler"]}', timeout=15) as response:
        applied = json.load(response)
    if int(applied['height']) != halt_height:
        raise RuntimeError('The SDK did not record the expected applied upgrade height')
    write(revision / 'source-migration.json', {'status': migration_status, 'application': application, 'applied_plan': applied})
    run(*compose, 'stop', 'cosmos')
    run(*compose, 'run', '--rm', '--no-deps', '--entrypoint', 'simd', 'cosmos', 'export',
        '--home', '/var/lib/simd', '--for-zero-height', '--output-document', '/rehearsal/revision-2/export.json')
    exported_bytes = (revision / 'export.json').read_bytes()
    genesis = json.loads(exported_bytes)
    if genesis['chain_id'] != profile['old_chain_id']:
        raise RuntimeError('The exported state belongs to another chain')
    # Export preprocessing resets staking heights through the SDK. Existing
    # profiles omitted the automatically created localhost client from their
    # allowlist, which makes their own exports fail genesis validation.
    ibc = json.loads(json.dumps(genesis['app_state']['ibc']))
    allowed = genesis['app_state']['ibc']['client_genesis']['params']['allowed_clients']
    allowed_additions = []
    if any(client['client_id'] == '09-localhost' for client in ibc['client_genesis']['clients']) and '09-localhost' not in allowed:
        allowed.append('09-localhost')
        allowed_additions.append('09-localhost')
    localhost_reset = None
    for client in genesis['app_state']['ibc']['client_genesis']['clients']:
        if client['client_id'] == '09-localhost':
            if client['client_state']['@type'] != '/ibc.lightclients.localhost.v2.ClientState':
                raise RuntimeError('Unexpected SDK localhost client type')
            # SDK zero-height export leaves its automatic self-client at height
            # zero, which fails its own ValidateBasic. InitGenesis overwrites
            # this self-client. Give genesis validation the new initial height.
            localhost_reset = {'before': client['client_state']['latest_height'],
                               'after': {'revision_number': profile['new_chain_id'].rsplit('-', 1)[1], 'revision_height': '1'}}
            client['client_state']['latest_height'] = localhost_reset['after']
    genesis['chain_id'] = profile['new_chain_id']
    genesis['initial_height'] = '1'
    now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=profile['clock_offset_seconds'])
    genesis['genesis_time'] = now.isoformat().replace('+00:00', 'Z')
    write(revision / 'genesis.json', genesis)
    expected_ibc = json.loads(json.dumps(ibc))
    expected_ibc['client_genesis']['params']['allowed_clients'].extend(allowed_additions)
    for client in expected_ibc['client_genesis']['clients']:
        if client['client_id'] == '09-localhost':
            client['client_state']['latest_height'] = localhost_reset['after']
    assert genesis['app_state']['ibc'] == expected_ibc
    run(*compose, 'run', '--rm', '--no-deps', '--entrypoint', 'sh', 'cosmos', '-c', '''set -eu
umask 077
mkdir -p /rehearsal/revision-2/config
cp /var/lib/simd/config/config.toml /var/lib/simd/config/app.toml /var/lib/simd/config/node_key.json /var/lib/simd/config/priv_validator_key.json /rehearsal/revision-2/config/
cp -a /var/lib/simd/keyring-test /rehearsal/revision-2/
''')
    service = config['services']['cosmos']
    service['image'] = profile['successor_cosmos_image']
    old_volume = service['volumes'][0]
    if old_volume != 'upgrade-cosmos-data:/var/lib/simd':
        raise RuntimeError('Unexpected source home mount')
    service['volumes'][0] = 'upgrade-cosmos-revision-2:/var/lib/simd'
    config['volumes']['upgrade-cosmos-revision-2'] = {'name': profile['project'] + '_upgrade-cosmos-revision-2'}
    service['environment'].update(COSMOS_CHAIN_ID=profile['new_chain_id'], COSMOS_GENESIS_TIME=genesis['genesis_time'])
    # The profile initializer deliberately accepts only v8-classic-1. A
    # successor starts directly from the explicitly exported genesis instead.
    service['entrypoint'] = ['simd', 'start', '--home', '/var/lib/simd', '--rpc.laddr', 'tcp://0.0.0.0:26657',
        '--grpc.address', '0.0.0.0:9090', '--api.enable=true', '--api.address', 'tcp://0.0.0.0:1317', '--minimum-gas-prices', '0.0025stake']
    write(compose_file, config)
    run(*compose, 'run', '--rm', '--no-deps', '--entrypoint', 'sh', 'cosmos', '-c', '''set -eu
umask 077
test ! -e /var/lib/simd/config/genesis.json
mkdir -p /var/lib/simd/config /var/lib/simd/data
cp /rehearsal/revision-2/config/* /var/lib/simd/config/
cp -a /rehearsal/revision-2/keyring-test /var/lib/simd/
cp /rehearsal/revision-2/genesis.json /var/lib/simd/config/genesis.json
printf '%s\\n' '{"height":"0","round":0,"step":0}' > /var/lib/simd/data/priv_validator_state.json
simd genesis validate --home /var/lib/simd
''')
    # A fresh signing journal is permitted only for this distinct chain ID.
    # The old home and its signing journal remain in the original volume.
    run(*compose, 'up', '-d', 'cosmos')
    deadline = time.monotonic() + 180
    while True:
        try:
            status = rpc('status')
            if status['node_info']['network'] == profile['new_chain_id'] and int(status['sync_info']['latest_block_height']) >= 2:
                break
        except (OSError, KeyError, ValueError):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('Successor did not commit blocks. Preserve both homes and inspect its logs.')
        time.sleep(1)
    first_block = rpc('block?height=1')
    assert first_block['block']['header']['validators_hash'] == old_block['block']['header']['next_validators_hash']
    write(revision / 'new-status.json', status)
    write(revision / 'new-first-block.json', first_block)
    report = {
        'format': 'tendermint-revision-restart-v1', 'old_chain_id': profile['old_chain_id'], 'new_chain_id': profile['new_chain_id'],
        'old_height': old_status['sync_info']['latest_block_height'], 'new_initial_height': '1',
        'old_export_height': application['last_block_height'],
        'old_home_preserved': True, 'old_home_mount': old_volume, 'new_home_mount': service['volumes'][0],
        'export_sha256': hashlib.sha256(exported_bytes).hexdigest(),
        'new_genesis_sha256': hashlib.sha256((revision/'genesis.json').read_bytes()).hexdigest(),
        'ibc_genesis_preserved': not allowed_additions and localhost_reset is None, 'ibc_route_state_preserved': True,
        'allowed_client_additions': allowed_additions, 'localhost_height_reset': localhost_reset, 'validator_set_preserved': True,
        'ibc_genesis_sha256': hashlib.sha256(json.dumps(ibc, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'imported_ibc_genesis_sha256': hashlib.sha256(json.dumps(expected_ibc, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'sdk_handler_applied': True, 'sdk_handler': profile['upgrade_handler'], 'sdk_applied_height': str(halt_height),
        'cardano_upgrade_observation': str(observation.relative_to(runtime)),
    }
    write(revision / 'result.json', report)
    profile['active_chain_id'] = profile['new_chain_id']
    profile['revision_restart_complete'] = True
    write(runtime / 'upgrade-profile.json', profile)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
