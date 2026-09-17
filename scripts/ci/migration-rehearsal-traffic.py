#!/usr/bin/env python3
"""Run and reconcile explicit packet steps on the owned populated rehearsal.

Uses the real Hermes/Gateway/chain path. Successful local logs alone never
authorize replay: stored canonical transaction evidence must still agree. An
interrupted step without a receipt stops for inspection instead of resending.
"""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import tomllib
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
COSMOS_ACCOUNT = 'cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt'


def read_json(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def write_new(path, value):
    with path.open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')


def packet_events(result, kind):
    return [item.get('event', item)[kind] for item in result
            if kind in item.get('event', item)]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def timestamp_ns(value):
    match = re.fullmatch(r'(.*?)(?:\.(\d{1,9}))?Z', value)
    require(match is not None, 'Expected exact UTC packet timeout')
    seconds = int(datetime.datetime.fromisoformat(match[1]).replace(tzinfo=datetime.timezone.utc).timestamp())
    return seconds * 1000000000 + int((match[2] or '').ljust(9, '0'))


def packet_observation(manifest_path, channel, **options):
    request = {'manifest': str(manifest_path), 'channel': channel, **options}
    response = subprocess.check_output(['node', str(ROOT / 'scripts/ci/verify-migration-packet.cjs')],
                                       input=json.dumps(request), text=True, cwd=ROOT)
    return json.loads(response.splitlines()[-1])


def packet_attributes(packet, kind):
    expected = {'packet_sequence': str(packet['sequence']), 'packet_src_channel': packet['source_channel'],
                'packet_dst_channel': packet['destination_channel'], 'packet_src_port': packet['source_port'],
                'packet_dst_port': packet['destination_port'], 'packet_data_hex': packet['data'].lower(),
                'packet_timeout_height': f"{packet['timeout_height']['revision_number']}-{packet['timeout_height']['revision_height']}",
                'packet_timeout_timestamp': str(timestamp_ns(packet['timeout_timestamp']['time']))}
    if kind == 'AcknowledgePacket':
        # ibc-go v8 omits data from this event. Canonical validation separately
        # checks the full MsgAcknowledgement body and its block data commitment.
        del expected['packet_data_hex']
    if kind == 'WriteAcknowledgement':
        expected['packet_ack_hex'] = b'{"result":"AQ=="}'.hex()
    return expected


def cosmos_packet_events(transaction, packet, kind):
    event_type = {'SendPacket': 'send_packet', 'WriteAcknowledgement': 'write_acknowledgement',
                  'AcknowledgePacket': 'acknowledge_packet'}[kind]
    expected = packet_attributes(packet, kind)
    def matches(event):
        attributes = {a['key']: a['value'] for a in event['attributes']}
        return event['type'] == event_type and all(
            attributes.get(key, '').lower() == value.lower() if key.endswith('_hex')
            else attributes.get(key) == value for key, value in expected.items())
    return [event for event in transaction.get('events', []) if int(transaction['code']) == 0 and matches(event)]


def matching_cosmos_event(transaction, packet, kind):
    return len(cosmos_packet_events(transaction, packet, kind)) == 1


def verify_cosmos_acknowledgement(block, index, packet, transaction):
    events = cosmos_packet_events(transaction, packet, 'AcknowledgePacket')
    require(len(events) == 1, 'Exactly one canonical acknowledgement event is required')
    indexes = [a['value'] for a in events[0]['attributes'] if a['key'] == 'msg_index']
    require(len(indexes) == 1 and re.fullmatch('[0-9]+', indexes[0]) is not None, 'Canonical acknowledgement message index is absent or ambiguous')
    request = {'block': block, 'txIndex': index, 'messageIndex': int(indexes[0]), 'packet': {
        **packet, 'timeoutNanoseconds': str(timestamp_ns(packet['timeout_timestamp']['time']))}}
    response = subprocess.check_output(['node', str(ROOT / 'scripts/ci/verify-migration-cosmos-message.cjs')],
                                       input=json.dumps(request), text=True, cwd=ROOT)
    return json.loads(response.splitlines()[-1])


def require_failed_before_build(log):
    rows = []
    for line in log.splitlines():
        try: rows.append(json.loads(line))
        except ValueError: continue
    outcomes = [row for row in rows if row.get('status') in ['success', 'error']]
    result = str(outcomes[-1].get('result', '')) if outcomes else ''
    read_failure = ('failed querying latest status of the destination chain' in result or
                    ('link initialization failed during channel counterparty verification' in result and
                     'failed during a query to chain' in result))
    require(outcomes and outcomes[-1].get('status') == 'error' and read_failure,
            'Only an explicitly identified application-status or channel-initialization read failure can be retried')
    messages = '\n'.join(str(row.get('fields', {}).get('message', '')) for row in rows).lower()
    require(not any(marker in messages for marker in ['unsigned', 'signed transaction', 'trusted node accepted',
            'transaction submitted', 'broadcast', 'checkpoint committed', 'assembled batch', 'submitted']),
            'Prior attempt may have constructed or submitted a transaction; reconcile it instead')


def validate_configuration(artifacts, channels, population, genesis_sha):
    config = tomllib.loads((artifacts / 'hermes.toml').read_text())
    chains = {chain['id']: chain for chain in config['chains']}
    require(len(chains) == len(config['chains']) == 2 and set(chains) == {'cardano-devnet', 'migration-462-1'}, 'Unexpected configured chains')
    require(len(set(channels)) == 2, 'Counterparty channels must be distinct')
    cardano, cosmos = chains['cardano-devnet'], chains['migration-462-1']
    for chain in chains.values():
        require(Path(chain['key_store_folder']).resolve() == artifacts / 'hermes-keys', 'Owned key directory required')
    for key, value in {'gateway_url': 'http://127.0.0.1:5501', 'signing_utxo_kupo_url': 'http://127.0.0.1:2742',
                       'signing_ogmios_url': 'http://127.0.0.1:2637', 'network_id': 0, 'type': 'Cardano'}.items():
        require(cardano.get(key) == value, 'Unsupported Cardano configuration: ' + key)
    for key, value in {'rpc_addr': 'http://127.0.0.1:28757', 'grpc_addr': 'http://127.0.0.1:9300', 'type': 'CosmosSdk'}.items():
        require(cosmos.get(key) == value, 'Unsupported counterparty configuration: ' + key)
    require(cosmos['event_source']['url'] == 'ws://127.0.0.1:28757/websocket', 'Unexpected event endpoint')
    manifest_path = Path(cardano['bridge_manifest_path']).resolve()
    require(manifest_path == artifacts / 'hermes-bridge-manifest.json', 'Owned pinned manifest required')
    manifest = json.loads(manifest_path.read_text())
    require(manifest['cardano']['chain_id'] == 'cardano-devnet' and manifest['cardano']['network_magic'] == 42,
            'Manifest network mismatch')
    require(population['genesisSha256'] == genesis_sha, 'Population belongs to another genesis')
    require(read_json('http://127.0.0.1:28757/status')['result']['node_info']['network'] == 'migration-462-1', 'Actual counterparty chain mismatch')
    host = manifest['host_state_nft']; host_unit = host['policy_id'] + '.' + host['token_name']
    mint = manifest['history']['host_state_nft_mint']
    original = read_json(f'http://127.0.0.1:2742/matches/{mint["output_index"]}@{mint["tx_hash"]}')
    require(len(original) == 1 and original[0]['value']['assets'].get(host_unit) == 1, 'Manifest Host identity is absent from selected chain')
    routes = []
    for index, remote in enumerate(channels):
        local = f'channel-{index}'
        observed = packet_observation(manifest_path, local, mode='route')
        require(bytes.fromhex(observed['counterparty']['channel_id']).decode() == remote and
                bytes.fromhex(observed['counterparty']['port_id']).decode() == 'transfer', 'Authenticated Cardano route mismatch')
        base = 'http://127.0.0.1:1527/ibc/core'
        channel = read_json(f'{base}/channel/v1/channels/{remote}/ports/transfer')['channel']
        require(channel['state'] == 'STATE_OPEN' and channel['ordering'] == 'ORDER_UNORDERED' and
                channel['counterparty'] == {'port_id': 'transfer', 'channel_id': local}, 'Actual counterparty route mismatch')
        require(len(channel['connection_hops']) == len(observed['connectionHops']) == 1, 'Single connection route required')
        connection = read_json(f'{base}/connection/v1/connections/{channel["connection_hops"][0]}')['connection']
        require(connection['counterparty']['connection_id'] == bytes.fromhex(observed['connectionHops'][0]).decode(), 'Connection identity mismatch')
        client = read_json(f'{base}/client/v1/client_states/{connection["client_id"]}')['client_state']
        require(client['@type'] == '/ibc.lightclients.probabilistic.v1.ClientState', 'Unsupported actual counterparty client')
        require(base64.b64decode(client['host_state_nft_policy_id']).hex() == host['policy_id'] and
                base64.b64decode(client['host_state_nft_token_name']).hex() == host['token_name'], 'Counterparty client authenticates another bridge')
        routes.append({'cardano': local, 'cosmos': remote, 'cosmosClient': connection['client_id']})
    return manifest, routes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--artifacts-dir', type=Path, required=True)
    p.add_argument('--clock-offset-seconds', type=int, required=True)
    p.add_argument('--cosmos-channels', nargs=2, required=True)
    p.add_argument('--verify-only', action='store_true', help='Recheck existing canonical receipts; never submit a missing step')
    p.add_argument('--reconcile-log', action='store_true', help='Read an existing successful settlement log and reconcile canonical inclusion without submitting; send attempts require separate timestamp evidence')
    p.add_argument('--retry-read-failure', metavar='STEP', help='Explicitly retry one settlement that failed querying application status before any construction/submission; retain every attempt')
    selection = p.add_mutually_exclusive_group(required=True)
    selection.add_argument('--phase', choices=['populate', 'settle-v2', 'settle-v3'])
    selection.add_argument('--step', choices=[
        'foreign-primary-send', 'foreign-primary-receive',
        'native-a-send', 'native-a-receive', 'native-b-send', 'native-b-receive',
        'foreign-secondary-send', 'foreign-secondary-receive',
        'native-timeout-send', 'native-pending-send', 'burn-timeout-send',
        'foreign-pending-send', 'native-return-send',
        'native-a-ack', 'native-b-ack', 'foreign-primary-ack', 'foreign-secondary-ack',
        'native-timeout-refund', 'burn-timeout-remint', 'native-pending-receive',
        'foreign-pending-receive', 'native-return-redeem',
        'new-native-send', 'new-native-receive', 'new-foreign-return-send', 'new-foreign-return-redeem',
        'native-pending-ack', 'foreign-pending-ack', 'native-return-ack', 'new-native-ack', 'new-foreign-return-ack',
        'v3-native-send', 'v3-native-receive', 'v3-native-ack', 'v3-foreign-send', 'v3-foreign-receive', 'v3-foreign-ack',
    ])
    args = p.parse_args()
    if args.reconcile_log and (args.phase or args.verify_only):
        p.error('--reconcile-log requires one explicit --step and cannot submit or combine with --verify-only')
    if args.retry_read_failure and (args.reconcile_log or args.verify_only or
                                   (args.step and args.step != args.retry_read_failure)):
        p.error('Read-failure retry requires the selected settlement step and cannot combine with verification/reconciliation')
    if args.phase:
        phases = {
            'populate': ['foreign-primary-send', 'foreign-primary-receive', 'native-a-send', 'native-a-receive',
                         'native-b-send', 'native-b-receive', 'foreign-secondary-send', 'foreign-secondary-receive',
                         'native-timeout-send', 'native-pending-send', 'burn-timeout-send',
                         'foreign-pending-send', 'native-return-send'],
            'settle-v2': ['native-a-ack', 'native-b-ack', 'foreign-primary-ack', 'foreign-secondary-ack',
                          'native-timeout-refund', 'burn-timeout-remint', 'native-pending-receive',
                          'foreign-pending-receive', 'native-return-redeem', 'new-native-send',
                          'new-native-receive', 'new-foreign-return-send', 'new-foreign-return-redeem'],
            # Leave these V2-era acknowledgements outstanding across V2→V3.
            'settle-v3': ['native-pending-ack', 'foreign-pending-ack', 'native-return-ack', 'new-native-ack',
                          'new-foreign-return-ack', 'v3-native-send', 'v3-native-receive', 'v3-native-ack',
                          'v3-foreign-send', 'v3-foreign-receive', 'v3-foreign-ack'],
        }
        if args.retry_read_failure and args.retry_read_failure not in phases[args.phase]:
            p.error('The retry step must belong to the selected phase')
        for step in phases[args.phase]:
            print(json.dumps({'phase': args.phase, 'starting': step}), flush=True)
            subprocess.run([sys.executable, str(Path(__file__).resolve()), '--runtime', str(args.runtime),
                            '--artifacts-dir', str(args.artifacts_dir), '--clock-offset-seconds', str(args.clock_offset_seconds),
                            '--cosmos-channels', *args.cosmos_channels, '--step', step,
                            *(['--verify-only'] if args.verify_only else []),
                            *(['--retry-read-failure', step] if args.retry_read_failure == step else [])], check=True)
        print(json.dumps({'phase': args.phase, 'complete': True}), flush=True)
        return
    runtime, artifacts = args.runtime.resolve(), args.artifacts_dir.resolve()
    for path in (runtime, artifacts):
        if not path.is_relative_to(ROOT / '.deployment-smoke'):
            p.error('Explicit owned rehearsal paths required')
    raw_genesis = (runtime / 'runtime/genesis-shelley.json').read_bytes()
    genesis = json.loads(raw_genesis)
    if genesis['networkMagic'] != 42:
        p.error('Only owned magic-42 is supported')
    project = json.loads((runtime / 'result.json').read_text())['project']
    if not re.fullmatch('cardano-deployment-test-[a-z0-9]+', project):
        p.error('Explicit disposable deployment-test project required')
    compose = ['docker', 'compose', '-p', project, '-f', str(runtime / 'compose.json')]
    require(subprocess.check_output(compose + ['exec', '-T', 'node', 'cat', '/runtime/genesis-shelley.json']) == raw_genesis,
            'Actual provider genesis differs from selected runtime')
    for service, internal, expected in [('ogmios', '1337', '127.0.0.1:2637'),
                                        ('kupo', '1442', '127.0.0.1:2742'),
                                        ('cosmos', '26657', '127.0.0.1:28757')]:
        actual = subprocess.check_output(compose + ['port', service, internal], text=True).strip()
        if actual != expected:
            p.error(f'{service} endpoint belongs to another runtime or unsupported port: {actual}')
    if any(not re.fullmatch(r'channel-\d+', channel) for channel in args.cosmos_channels):
        p.error('Supply the two actual existing Cosmos channel IDs')
    population = json.loads((runtime / 'wallet-population.json').read_text())
    genesis_sha = hashlib.sha256(raw_genesis).hexdigest()
    manifest, routes = validate_configuration(artifacts, args.cosmos_channels, population, genesis_sha)
    source_manifest = artifacts / f'bridge-manifest-{manifest["migration"]["generation"]}.json'
    require(json.loads(source_manifest.read_text()) == manifest, 'Installed manifest differs from retained generation artifact')
    asset_a, asset_b = population['units']
    primary = population['primary']
    secondary = population['secondary']
    # Cosmos -> Cardano packet receiver is the payment key hash, as required
    # by this repository's transfer ABI; the public fixture addresses are not
    # rewritten into new asset/route identities.
    primary_hash = population['primaryCredential']
    secondary_hash = population['secondaryCredential']
    if (primary_hash != '8f310f79f977bdf0befedfae3374a625e64c9a69a40c3c8fca607dac'
            or secondary_hash != '96b6f34d2eadf71cccde7d85bb8c7c91e34e0f66e34b4195ff94aef0'):
        p.error('Only the two disposable published fixture keys are supported')
    if not primary.startswith('addr_test1') or not secondary.startswith('addr_test1'):
        p.error('Owned fixture wallets required')
    cardano, cosmos = 'cardano-devnet', 'migration-462-1'
    c0, c1 = args.cosmos_channels
    cosmos_native_a = 'ibc/' + hashlib.sha256(f'transfer/{c0}/{asset_a}'.encode()).hexdigest().upper()

    def send(source, channel, amount, denom, receiver, timeout=518400):
        destination = cosmos if source == cardano else cardano
        return (['tx', 'ft-transfer', '--src-chain', source, '--dst-chain', destination,
                 '--src-port', 'transfer', '--src-channel', channel, '--amount', str(amount),
                 '--denom', denom, '--receiver', receiver, '--timeout-seconds', str(timeout)],
                'SendPacket', source)

    def relay(source, channel, sequence, *, ack=False, timeout=False):
        destination = cosmos if source == cardano else cardano
        return (['tx', 'packet-ack' if ack else 'packet-recv', '--src-chain', source,
                 '--dst-chain', destination, '--src-port', 'transfer', '--src-channel', channel,
                 '--packet-sequences', str(sequence)],
                'AcknowledgePacket' if ack else 'TimeoutPacket' if timeout else 'WriteAcknowledgement',
                source if timeout else destination)

    steps = {
        'foreign-primary-send': send(cosmos, c0, 1000000, 'stake', primary_hash),
        'foreign-primary-receive': relay(cosmos, c0, 1),
        'native-a-send': send(cardano, 'channel-0', 10000, asset_a, COSMOS_ACCOUNT),
        'native-a-receive': relay(cardano, 'channel-0', 1),
        'native-b-send': send(cardano, 'channel-1', 7000, asset_b, COSMOS_ACCOUNT),
        'native-b-receive': relay(cardano, 'channel-1', 1),
        'foreign-secondary-send': send(cosmos, c1, 500000, 'stake', secondary_hash),
        'foreign-secondary-receive': relay(cosmos, c1, 1),
        'native-timeout-send': send(cardano, 'channel-0', 1000, asset_a, COSMOS_ACCOUNT, 600),
        'native-pending-send': send(cardano, 'channel-1', 900, asset_b, COSMOS_ACCOUNT),
        'burn-timeout-send': send(cardano, 'channel-0', 100000, 'transfer/channel-0/stake', COSMOS_ACCOUNT, 600),
        'foreign-pending-send': send(cosmos, c0, 123456, 'stake', primary_hash),
        'native-return-send': send(cosmos, c0, 2000, cosmos_native_a, primary_hash),
        'native-a-ack': relay(cosmos, c0, 1, ack=True),
        'native-b-ack': relay(cosmos, c1, 1, ack=True),
        'foreign-primary-ack': relay(cardano, 'channel-0', 1, ack=True),
        'foreign-secondary-ack': relay(cardano, 'channel-1', 1, ack=True),
        'native-timeout-refund': relay(cardano, 'channel-0', 2, timeout=True),
        'burn-timeout-remint': relay(cardano, 'channel-0', 3, timeout=True),
        'native-pending-receive': relay(cardano, 'channel-1', 2),
        'foreign-pending-receive': relay(cosmos, c0, 2),
        'native-return-redeem': relay(cosmos, c0, 3),
        'new-native-send': send(cardano, 'channel-0', 333, asset_a, COSMOS_ACCOUNT),
        'new-native-receive': relay(cardano, 'channel-0', 4),
        'new-foreign-return-send': send(cardano, 'channel-0', 5000, 'transfer/channel-0/stake', COSMOS_ACCOUNT),
        'new-foreign-return-redeem': relay(cardano, 'channel-0', 5),
        'native-pending-ack': relay(cosmos, c1, 2, ack=True),
        'foreign-pending-ack': relay(cardano, 'channel-0', 2, ack=True),
        'native-return-ack': relay(cardano, 'channel-0', 3, ack=True),
        'new-native-ack': relay(cosmos, c0, 4, ack=True),
        'new-foreign-return-ack': relay(cosmos, c0, 5, ack=True),
        'v3-native-send': send(cardano, 'channel-1', 444, asset_b, COSMOS_ACCOUNT),
        'v3-native-receive': relay(cardano, 'channel-1', 3),
        'v3-native-ack': relay(cosmos, c1, 3, ack=True),
        'v3-foreign-send': send(cosmos, c1, 777, 'stake', secondary_hash),
        'v3-foreign-receive': relay(cosmos, c1, 2),
        'v3-foreign-ack': relay(cardano, 'channel-1', 2, ack=True),
    }
    operation, event_kind, destination = steps[args.step]
    directory = artifacts / 'traffic'
    directory.mkdir(exist_ok=True)
    receipt_path = directory / f'{args.step}.json'
    log_path = directory / f'{args.step}.log'
    identity = {'genesisSha256': genesis_sha, 'deploymentId': manifest['deployment_id'], 'operation': operation}
    source_steps = {
        'foreign-primary-receive': 'foreign-primary-send', 'native-a-receive': 'native-a-send',
        'native-b-receive': 'native-b-send', 'foreign-secondary-receive': 'foreign-secondary-send',
        'native-a-ack': 'native-a-send', 'native-b-ack': 'native-b-send',
        'foreign-primary-ack': 'foreign-primary-send', 'foreign-secondary-ack': 'foreign-secondary-send',
        'native-timeout-refund': 'native-timeout-send', 'burn-timeout-remint': 'burn-timeout-send',
        'native-pending-receive': 'native-pending-send', 'foreign-pending-receive': 'foreign-pending-send',
        'native-return-redeem': 'native-return-send', 'new-native-receive': 'new-native-send',
        'new-foreign-return-redeem': 'new-foreign-return-send',
        'native-pending-ack': 'native-pending-send', 'foreign-pending-ack': 'foreign-pending-send',
        'native-return-ack': 'native-return-send', 'new-native-ack': 'new-native-send',
        'new-foreign-return-ack': 'new-foreign-return-send',
        'v3-native-receive': 'v3-native-send', 'v3-native-ack': 'v3-native-send',
        'v3-foreign-receive': 'v3-foreign-send', 'v3-foreign-ack': 'v3-foreign-send',
    }
    sequences = {'foreign-primary-send': 1, 'native-a-send': 1, 'native-b-send': 1,
                 'foreign-secondary-send': 1, 'native-timeout-send': 2, 'native-pending-send': 2,
                 'burn-timeout-send': 3, 'foreign-pending-send': 2, 'native-return-send': 3,
                 'new-native-send': 4, 'new-foreign-return-send': 5, 'v3-native-send': 3, 'v3-foreign-send': 2}

    def destination_time():
        destination_chain = cosmos if steps[args.step][2] == cardano else cardano
        if destination_chain == cardano:
            return packet_observation(source_manifest, 'channel-0', mode='chain-time')
        block = read_json('http://127.0.0.1:28757/block')['result']
        return {'chain': cosmos, 'height': block['block']['header']['height'], 'hash': block['block_id']['hash'],
                'timestampNs': str(timestamp_ns(block['block']['header']['time']))}

    def validate_packet(packet, step, destination_before, destination_after):
        source_step = source_steps.get(step, step)
        send_operation, _, sender_chain = steps[source_step]
        options = dict(zip(send_operation[2::2], send_operation[3::2]))
        source = options['--src-channel']
        destination_channel = dict(zip(['channel-0', 'channel-1'], [c0, c1]))[source] if sender_chain == cardano else dict(zip([c0, c1], ['channel-0', 'channel-1']))[source]
        require(packet['source_channel'] == source and packet['destination_channel'] == destination_channel and
                packet['source_port'] == packet['destination_port'] == 'transfer' and packet['sequence'] == sequences[source_step],
                'Packet differs from exact intended sequence/route')
        denom = options['--denom']
        if denom == cosmos_native_a:
            denom = f'transfer/{c0}/{asset_a}'
        expected = {'amount': options['--amount'], 'denom': denom, 'receiver': options['--receiver'],
                    'sender': primary_hash if sender_chain == cardano else COSMOS_ACCOUNT}
        require(json.loads(bytes.fromhex(packet['data'])) == expected, 'ICS20 payload differs from explicit intent')
        require(packet['timeout_height'] == {'revision_number': 0, 'revision_height': 0}, 'Unexpected timeout height')
        if step in source_steps:
            prior = json.loads((directory / f'{source_step}.json').read_text())
            validate_canonical(prior, source_step)
            require(packet == prior['events'][0]['packet'], 'Settlement is not the exact canonical original send packet')
        else:
            timeout = int(options['--timeout-seconds'])
            lower, upper = int(destination_before['timestampNs']), int(destination_after['timestampNs'])
            require(lower <= upper, 'Destination status time regressed; reconcile rollback')
            require(lower + timeout * 1000000000 <= timestamp_ns(packet['timeout_timestamp']['time']) <=
                    upper + timeout * 1000000000, 'Packet timeout differs from destination-chain time plus intended duration')

    def validate_canonical(record, step=args.step):
        expected_identity = {**identity, 'operation': steps[step][0]}
        require(all(record.get(key) == value for key, value in expected_identity.items()), 'Receipt belongs to another chain/deployment/operation')
        kind = steps[step][1]
        require(len(record['events']) == 1, 'Expected one recorded packet')
        packet = record['events'][0]['packet']
        require(record['routes'] == routes, 'Recorded counterparty relationship changed')
        historical_manifest = Path(record['sourceManifest']).resolve()
        require(historical_manifest.parent == artifacts and
                hashlib.sha256(historical_manifest.read_bytes()).hexdigest() == record['sourceManifestSha256'], 'Source manifest provenance')
        require(json.loads(historical_manifest.read_text())['deployment_id'] == manifest['deployment_id'], 'Wrong historical deployment')
        packet_matches = 0
        for anchor in record['canonicalTransactions']:
            if anchor['chain'] == cardano:
                outputs = read_json(f'http://127.0.0.1:2742/matches/*@{anchor["hash"]}')
                require(outputs and all(out['created_at'] == anchor['createdAt'] for out in outputs), 'Cardano transaction changed; reconcile rollback')
                channel = packet['destination_channel'] if kind == 'WriteAcknowledgement' else packet['source_channel']
                evidence = packet_observation(historical_manifest, channel, mode='packet', transaction=anchor['hash'],
                    packet={**packet, 'timeoutNanoseconds': str(timestamp_ns(packet['timeout_timestamp']['time']))}, kind=kind)
                packet_matches += int(evidence['packetTransition'])
            else:
                block = read_json(f'http://127.0.0.1:28757/block?height={anchor["height"]}')['result']
                require(block['block_id']['hash'] == anchor['blockHash'], 'Cosmos block changed; reconcile rollback')
                transaction = read_json(f'http://127.0.0.1:28757/block_results?height={anchor["height"]}')['result']['txs_results'][anchor['txIndex']]
                require(matching_cosmos_event(transaction, packet, kind), 'Exact Cosmos packet is absent')
                if kind == 'AcknowledgePacket':
                    message = verify_cosmos_acknowledgement(block['block'], anchor['txIndex'], packet, transaction)
                    if 'packetMessage' in anchor:
                        require(anchor['packetMessage'] == message, 'Canonical acknowledgement message evidence changed')
                    anchor['packetMessage'] = message
                packet_matches += 1
        require(packet_matches == 1, 'Exactly one canonical packet transition required')
        validate_packet(packet, step, record['destinationBefore'], record['destinationAfter'])
        return record

    if receipt_path.exists():
        record = validate_canonical(json.loads(receipt_path.read_text()))
        print(json.dumps({'step': args.step, 'canonicalReceiptReused': True, 'events': len(record['events']),
                          'packetMessages': [a['packetMessage'] for a in record['canonicalTransactions'] if 'packetMessage' in a]}))
        return
    if args.verify_only:
        raise RuntimeError(f'Missing canonical receipt: {receipt_path}; verification never submits traffic')
    if args.retry_read_failure:
        require(args.step in source_steps and log_path.exists(), 'Read-failure retry requires an existing settlement attempt')
        for attempt in [log_path, *directory.glob(f'{args.step}.retry-*.log')]:
            require_failed_before_build(attempt.read_text())
        log_path = directory / f'{args.step}.retry-{uuid.uuid4().hex}.log'
    if log_path.exists() and not args.reconcile_log:
        raise RuntimeError(f'Unresolved prior attempt: {log_path}; inspect exact chain outcomes before any new submission')
    if args.reconcile_log:
        require(log_path.exists() and event_kind != 'SendPacket', 'Reconciliation requires an existing settlement log; it cannot submit or reconstruct send timestamp evidence')
    command = ['python3', str(ROOT / 'scripts/ci/migration-hermes.py'), 'run', '--runtime', str(runtime),
               '--artifacts-dir', str(artifacts), '--clock-offset-seconds', str(args.clock_offset_seconds),
               '--wait-ready', '--', '--json', *operation]
    # Reconcile the original send before attempting any settlement.
    if args.step in source_steps:
        prior_step = source_steps[args.step]
        validate_canonical(json.loads((directory / f'{prior_step}.json').read_text()), prior_step)
    destination_before = destination_time() if event_kind == 'SendPacket' else None
    started = None if args.reconcile_log else time.time() + args.clock_offset_seconds
    returncode = 0
    if not args.reconcile_log:
        with log_path.open('x') as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
        returncode = result.returncode
    finished = None if args.reconcile_log else time.time() + args.clock_offset_seconds
    destination_after = destination_time() if event_kind == 'SendPacket' else None
    lines = log_path.read_text().splitlines()
    outcomes = []
    for line in lines:
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if value.get('status') in ('success', 'error'):
            outcomes.append(value)
    if returncode or not outcomes or outcomes[-1]['status'] != 'success':
        raise RuntimeError(f'Hermes operation failed; inspect {log_path}; no automatic resubmission')
    events = packet_events(outcomes[-1]['result'], event_kind)
    if len(events) != 1:
        raise RuntimeError(f'Expected exactly one {event_kind}, observed {len(events)}; inspect {log_path}')
    event = events[0]
    if event_kind == 'WriteAcknowledgement' and bytes.fromhex(event['ack']).decode() != '{"result":"AQ=="}':
        raise RuntimeError('Receive produced an error acknowledgement')
    packet = event['packet']
    payload_omitted = event_kind == 'AcknowledgePacket' and destination == cosmos and packet['data'] == ''
    if payload_omitted:
        original = json.loads((directory / f'{source_steps[args.step]}.json').read_text())
        validate_canonical(original, source_steps[args.step])
        # Only the known event omission is filled; every field must then match
        # the original send and the actual committed transaction message below.
        packet['data'] = original['events'][0]['packet']['data']
    validate_packet(packet, args.step, destination_before, destination_after)
    anchors = []
    if destination == cardano:
        hashes = sorted(set(re.findall(r'Transaction submitted: ([0-9a-f]{64})', '\n'.join(lines))))
        if not hashes:
            raise RuntimeError('No canonical Cardano transaction identities in successful operation')
        for txhash in hashes:
            outputs = read_json(f'http://127.0.0.1:2742/matches/*@{txhash}')
            if not outputs or any(out['created_at'] != outputs[0]['created_at'] for out in outputs):
                raise RuntimeError('Missing or inconsistent canonical Cardano inclusion')
            anchors.append({'chain': cardano, 'hash': txhash, 'createdAt': outputs[0]['created_at']})
    else:
        heights = {int(item['height']['revision_height']) for item in outcomes[-1]['result'] if 'height' in item}
        for line in lines:
            try:
                message = json.loads(line).get('fields', {}).get('message', '')
            except ValueError:
                continue
            if '[Sync->migration-462-1] result events:' in message:
                heights.update(map(int, re.findall(r'at height 1-(\d+)', message)))
        for height in heights:
            results = read_json(f'http://127.0.0.1:28757/block_results?height={height}')['result']
            for index, transaction in enumerate(results.get('txs_results') or []):
                if int(transaction['code']) != 0:
                    continue
                if matching_cosmos_event(transaction, packet, event_kind):
                    block = read_json(f'http://127.0.0.1:28757/block?height={height}')['result']
                    if event_kind == 'AcknowledgePacket':
                        verify_cosmos_acknowledgement(block['block'], index, packet, transaction)
                    anchors.append({'chain': cosmos, 'height': height, 'blockHash': block['block_id']['hash'], 'txIndex': index})
        if len(anchors) != 1:
            raise RuntimeError('Could not uniquely identify the exact accepted Cosmos packet event')
    record = {**identity, 'step': args.step, 'events': events, 'canonicalTransactions': anchors,
              'reconciledFromRetainedLog': args.reconcile_log, 'eventPacketPayloadOmitted': payload_omitted,
              'attemptLog': str(log_path), 'attemptLogSha256': hashlib.sha256(log_path.read_bytes()).hexdigest(),
              'startedAt': started, 'finishedAt': finished, 'routes': routes,
              'destinationBefore': destination_before, 'destinationAfter': destination_after,
              'sourceManifest': str(source_manifest), 'sourceManifestSha256': hashlib.sha256(source_manifest.read_bytes()).hexdigest()}
    validate_canonical(record)
    write_new(receipt_path, record)
    print(json.dumps({'step': args.step, 'event': event_kind, 'packetSequence': packet['sequence'], 'canonicalTransactions': anchors,
                      'packetMessages': [a['packetMessage'] for a in anchors if 'packetMessage' in a]}))


if __name__ == '__main__':
    main()
