#!/usr/bin/env python3
"""Retain the exact committed packet bytes before replacing a CometBFT home."""
import argparse
import base64
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--sequence', type=int, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke'):
        parser.error('Expected the owned local runtime')
    profile = json.loads((runtime / 'upgrade-profile.json').read_text())
    if profile['runtime'] != str(runtime) or args.sequence < 1:
        parser.error('Invalid runtime or packet sequence')
    if args.out.exists() or not args.out.resolve().is_relative_to(runtime):
        parser.error('Select a new evidence file in this runtime')
    base = f'http://127.0.0.1:{profile["ports"]["cosmos_rpc"]}'

    def rpc(method, **parameters):
        with urllib.request.urlopen(base + '/' + method + '?' + urllib.parse.urlencode(parameters), timeout=30) as response:
            value = json.load(response)
        if 'error' in value:
            raise RuntimeError(value['error'])
        return value['result']

    status = rpc('status')
    if status['node_info']['network'] != profile.get('active_chain_id', profile['old_chain_id']):
        raise RuntimeError('The selected RPC belongs to another revision')
    channel = profile['route']['cosmos_channel_id']
    query = f"send_packet.packet_src_channel='{channel}' AND send_packet.packet_sequence='{args.sequence}'"
    result = rpc('tx_search', query=json.dumps(query), prove='true', per_page='10')
    if result['total_count'] != '1' or len(result['txs']) != 1:
        raise RuntimeError('Expected exactly one original send transaction. Preserve old-revision evidence before restarting.')
    transaction = result['txs'][0]
    if transaction['tx_result'].get('code', 0):
        raise RuntimeError('The send transaction failed')
    events = [{a['key']: a['value'] for a in event['attributes']}
              for event in transaction['tx_result']['events'] if event['type'] == 'send_packet']
    events = [e for e in events if e['packet_src_channel'] == channel and e['packet_sequence'] == str(args.sequence)]
    if len(events) != 1:
        raise RuntimeError('The transaction does not identify one exact packet')
    event = events[0]
    revision, height = event['packet_timeout_height'].split('-')
    packet = {
        'sequence': event['packet_sequence'], 'source_port': event['packet_src_port'],
        'source_channel': event['packet_src_channel'], 'destination_port': event['packet_dst_port'],
        'destination_channel': event['packet_dst_channel'],
        'data': base64.b64encode(bytes.fromhex(event['packet_data_hex'])).decode(),
        'timeout_height': {'revision_number': revision, 'revision_height': height},
        'timeout_timestamp': event['packet_timeout_timestamp'],
    }
    assert packet['source_port'] == packet['destination_port'] == 'transfer'
    assert packet['destination_channel'] == profile['route']['cardano_channel_id']
    evidence = {'format': 'committed-sdk-send-packet-v1', 'source_chain_id': status['node_info']['network'],
                'packet': packet, 'transaction': transaction}
    args.out.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'evidence': str(args.out), 'transaction': transaction['hash'], 'sequence': args.sequence}))


if __name__ == '__main__':
    main()
