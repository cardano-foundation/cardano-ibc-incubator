#!/usr/bin/env python3
"""Submit captured historical acknowledgement bytes to the actual owned ibc-go node.

Uses the disposable container's existing relayer key. It never reconstructs a
proof, changes a client, queries a newer root, or repairs acknowledgement bytes.
A signed intent is retained before broadcast; an unresolved intent is not retried
with a new account sequence. Reruns reconcile its exact hash from the node.
"""
import argparse
import base64
import calendar
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def timestamp_ns(text):
    match = re.fullmatch(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z', text)
    if not match:
        raise ValueError('Expected an exact UTC packet timeout with at most nine fractional digits')
    seconds = calendar.timegm(datetime.datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S').timetuple())
    return str(seconds * 1_000_000_000 + int((match[2] or '').ljust(9, '0')))


def write_new(path, value):
    with path.open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--project', required=True)
    p.add_argument('--proof', type=Path, required=True)
    p.add_argument('--packet', type=Path, required=True, help='Exact original Hermes packet object, without its event wrapper')
    p.add_argument('--out', type=Path, required=True, help='New receipt prefix, or an existing unresolved intent to inspect')
    p.add_argument('--expect-duplicate', action='store_true', help='Require CheckTx or delivery to reject this already acknowledged packet')
    p.add_argument('--settled-receipt', type=Path, help='Required for duplicate controls: successful receipt for this exact message')
    args = p.parse_args()
    runtime, proof_path, packet_path, output = [x.resolve() for x in (args.runtime, args.proof, args.packet, args.out)]
    for path in (runtime, proof_path, packet_path, output):
        if not path.is_relative_to(ROOT / '.deployment-smoke'):
            p.error('Only explicit owned rehearsal artifacts are supported')
    if not re.fullmatch(r'cardano-deployment-test-[a-z0-9]+', args.project):
        p.error('Explicit disposable deployment-test project required')
    genesis = json.loads((runtime / 'runtime/genesis-shelley.json').read_text())
    if genesis['networkMagic'] != 42:
        p.error('Only magic-42 is supported')
    config = json.loads((runtime / 'compose.json').read_text())
    cosmos_env = config['services']['cosmos']['environment']
    if cosmos_env['COSMOS_CHAIN_ID'] != 'migration-462-1' or cosmos_env['COSMOS_PROFILE'] != 'v8-classic':
        p.error('Only the actual owned ibc-go v8 classic counterparty is supported')
    compose = ['docker', 'compose', '-p', args.project, '-f', str(runtime / 'compose.json'), 'exec', '-T', 'cosmos', 'simd']

    def cli(arguments, value=None):
        return subprocess.check_output(compose + arguments, input=json.dumps(value) if value is not None else None, text=True)

    proof = json.loads(proof_path.read_text())
    packet = json.loads(packet_path.read_text())
    if proof['format'] != 'cardano-ibc-historical-proof-v1':
        raise ValueError('Expected an actual historical gRPC proof capture')
    if (packet['destination_channel'] != proof['channelId'] or str(packet['sequence']) != proof['sequence']
            or packet['destination_port'] != 'transfer' or packet['source_port'] != 'transfer'):
        raise ValueError('Original packet does not match the captured acknowledgement route')
    acknowledgement = base64.b64decode(proof['acknowledgementBase64'], validate=True)
    json.loads(acknowledgement)
    signer = cli(['keys', 'show', 'relayer', '-a', '--home', '/var/lib/simd', '--keyring-backend', 'test']).strip()
    source_packet = {
        key: str(packet[key]) for key in ('sequence', 'source_port', 'source_channel', 'destination_port', 'destination_channel')
    }
    source_packet.update(data=base64.b64encode(bytes.fromhex(packet['data'])).decode(),
                         timeout_height={k: str(v) for k, v in packet['timeout_height'].items()},
                         timeout_timestamp=timestamp_ns(packet['timeout_timestamp']['time']))
    message = {'@type': '/ibc.core.channel.v1.MsgAcknowledgement', 'packet': source_packet,
               'acknowledgement': proof['acknowledgementBase64'], 'proof_acked': proof['acknowledgementProofBase64'],
               'proof_height': {'revision_number': '0', 'revision_height': proof['height']}, 'signer': signer}
    unsigned = {'body': {'messages': [message], 'memo': 'owned migration historical continuity', 'timeout_height': '0',
                         'extension_options': [], 'non_critical_extension_options': []},
                'auth_info': {'signer_infos': [], 'fee': {'amount': [{'denom': 'stake', 'amount': '12500'}],
                                                        'gas_limit': '5000000', 'payer': '', 'granter': ''}}, 'signatures': []}
    intent = output.with_suffix('.intent.json')
    digest = hashlib.sha256(json.dumps(message, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if args.expect_duplicate:
        if not args.settled_receipt or not args.settled_receipt.resolve().is_relative_to(ROOT / '.deployment-smoke'):
            p.error('Duplicate controls require --settled-receipt from this owned rehearsal')
        settled = json.loads(args.settled_receipt.read_text())
        if (settled.get('messageSha256') != digest or settled.get('expectedDuplicate') is not False
                or int(settled['result']['code']) != 0 or int(settled['result']['height']) <= 0):
            raise ValueError('Duplicate control requires successful delivery of this exact packet/proof/message')
    broadcast = False
    if intent.exists():
        record = json.loads(intent.read_text())
        if record['messageSha256'] != digest or record['expectDuplicate'] != args.expect_duplicate:
            raise ValueError('Existing intent belongs to another packet/proof or acceptance condition')
    else:
        signed = json.loads(cli(['tx', 'sign', '/dev/stdin', '--home', '/var/lib/simd', '--keyring-backend', 'test',
                                 '--from', 'relayer', '--chain-id', 'migration-462-1'], unsigned))
        encoded = cli(['tx', 'encode', '/dev/stdin', '--home', '/var/lib/simd'], signed).strip()
        txhash = hashlib.sha256(base64.b64decode(encoded, validate=True)).hexdigest().upper()
        record = {'messageSha256': digest, 'expectDuplicate': args.expect_duplicate, 'transactionHash': txhash,
                  'signed': signed, 'proofFileSha256': hashlib.sha256(proof_path.read_bytes()).hexdigest()}
        write_new(intent, record)
        broadcast = True
    if broadcast:
        response = json.loads(cli(['tx', 'broadcast', '/dev/stdin', '--home', '/var/lib/simd', '--output', 'json'], record['signed']))
        write_new(output.with_suffix('.checktx.json'), response)
    checktx_path = output.with_suffix('.checktx.json')
    if checktx_path.exists():
        response = json.loads(checktx_path.read_text())
        if response['txhash'].upper() != record['transactionHash']:
            raise RuntimeError('Saved CheckTx response does not identify this signed intent')
        # ibc-go v8's RedundantRelayDecorator returns channel/22 during
        # CheckTx when its AcknowledgePacket call reports ErrNoOpMsg. This is
        # a specific duplicate-packet rejection, not a generic invalid tx.
        if (args.expect_duplicate and response.get('codespace') == 'channel'
                and int(response.get('code', -1)) == 22
                and response.get('raw_log') == 'packet messages are redundant'):
            receipt = output.with_suffix('.receipt.json')
            if not receipt.exists():
                write_new(receipt, {'format': 'cardano-ibc-historical-ack-receipt-v1',
                                    'proofHeight': proof['height'], 'messageSha256': digest,
                                    'expectedDuplicate': True, 'rejectionStage': 'CheckTx',
                                    'settledTransaction': settled['result']['txhash'], 'result': response})
            print(json.dumps({'transaction': record['transactionHash'], 'code': 22,
                              'expectedDuplicate': True, 'rejectionStage': 'CheckTx'}))
            return
        if int(response.get('code', -1)) != 0:
            raise RuntimeError(f'CheckTx did not accept this exact signed intent: {response}')
    deadline = time.monotonic() + 60
    while True:
        try:
            url = 'http://127.0.0.1:1527/cosmos/tx/v1beta1/txs/' + record['transactionHash']
            with urllib.request.urlopen(url, timeout=10) as response:
                result = json.load(response)['tx_response']
            break
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            if time.monotonic() >= deadline:
                raise RuntimeError('Signed intent is unresolved; inspect/reconcile this exact hash before any new submission') from error
            time.sleep(1)
    code = int(result['code'])
    if args.expect_duplicate:
        if code == 0 or not re.search(r'packet commitment (?:not found|does not exist)|no packet commitment', result.get('raw_log', ''), re.I):
            raise RuntimeError(f'Expected an already-settled packet rejection, got {result}')
    elif code != 0:
        raise RuntimeError(f'Historical acknowledgement was rejected: {result}')
    receipt = output.with_suffix('.receipt.json')
    if not receipt.exists():
        write_new(receipt, {'format': 'cardano-ibc-historical-ack-receipt-v1', 'proofHeight': proof['height'],
                            'messageSha256': digest, 'expectedDuplicate': args.expect_duplicate, 'result': result})
    print(json.dumps({'transaction': record['transactionHash'], 'height': result['height'], 'code': code,
                      'gasUsed': result['gas_used'], 'expectedDuplicate': args.expect_duplicate}))


if __name__ == '__main__':
    main()
