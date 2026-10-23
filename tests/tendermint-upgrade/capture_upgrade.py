#!/usr/bin/env python3
"""Retain upgrade-store proofs and the real signed header authenticating them."""
import argparse
import calendar
import datetime
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from verify_capture import verify

ROOT = Path(__file__).resolve().parents[2]


def timestamp_ns(value):
    match = re.fullmatch(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z', value)
    if not match:
        raise ValueError('Expected an exact UTC header timestamp')
    seconds = calendar.timegm(datetime.datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S').timetuple())
    return seconds * 10**9 + int((match[2] or '').ljust(9, '0'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--upgrade-height', type=int, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke'):
        parser.error('Expected the owned disposable runtime')
    profile = json.loads((runtime / 'upgrade-profile.json').read_text())
    height = args.upgrade_height
    destination = runtime / f'upgrade-proof-{height}.json'
    if destination.exists() or height < 2:
        parser.error('Select a new proof capture at a positive upgrade height')
    base = f'http://127.0.0.1:{profile["ports"]["cosmos_rpc"]}'

    def rpc(method, **params):
        with urllib.request.urlopen(base + '/' + method + '?' + urllib.parse.urlencode(params), timeout=15) as response:
            value = json.load(response)
        if 'error' in value:
            raise RuntimeError(value['error'])
        return value['result']

    deadline = time.monotonic() + 600
    while True:
        try:
            if int(rpc('status')['sync_info']['latest_block_height']) >= height:
                break
        except (OSError, TimeoutError):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('Source did not reach the selected height')
        time.sleep(2)
    header = rpc('commit', height=str(height))
    if header['signed_header']['header']['chain_id'] != profile['old_chain_id']:
        raise RuntimeError('Expected the old-chain signed commit')
    application = rpc('abci_info')
    # At the SDK halt the latest signed commit is returned as a seen commit.
    # There is no next block from which to load its canonical commit record.
    # Verify its signatures below instead of requiring that storage flag.
    if not header['canonical'] and int(application['response']['last_block_height']) != height-1:
        raise RuntimeError('A seen commit is accepted only at the actual SDK halt')
    proofs = {}
    for name in ['upgradedClient', 'upgradedConsState']:
        key = f'upgradedIBCState/{height}/{name}'.encode()
        query = rpc('abci_query', path='"/store/upgrade/key"', data='0x' + key.hex(), height=str(height-1), prove='true')
        response = query['response']
        if response.get('code', 0) or not response.get('value') or int(response['height']) != height-1:
            raise RuntimeError(f'The upgrade commitment is missing at {height-1}: {response}')
        if len(response['proofOps']['ops']) != 2:
            raise RuntimeError('Expected both IAVL and multistore proof layers')
        proofs[name] = query
    decode = r'''
const fs = require('fs')
const { Any } = require('@cardano-ibc/proto-types/build/google/protobuf/any')
const { ClientState, ConsensusState } = require('@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint')
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const value = name => Any.decode(Buffer.from(input[name].response.value, 'base64')).value
const kernel = ConsensusState.decode(value('upgradedConsState'))
console.log(JSON.stringify({client: ClientState.toJSON(ClientState.decode(value('upgradedClient'))),
  kernel: ConsensusState.toJSON(kernel), kernel_timestamp_ns: (kernel.timestamp.seconds * 1000000000n + BigInt(kernel.timestamp.nanos)).toString()}))
'''
    decoded = json.loads(subprocess.check_output(['node', '-e', decode], input=json.dumps(proofs),
        cwd=ROOT/'cardano/gateway', text=True))
    signed_time = header['signed_header']['header']['time']
    gap = timestamp_ns(signed_time) - int(decoded['kernel_timestamp_ns'])
    result = {'format': 'sdk-live-upgrade-proof-v1', 'upgrade_height': str(height), 'store_height': str(height-1),
              'header': header, 'application': application, 'validators': rpc('validators', height=str(height)), 'proofs': proofs,
              **decoded, 'trusted_header_timestamp_ns': str(timestamp_ns(signed_time)),
              'trusted_header_minus_kernel_ns': str(gap)}
    with tempfile.TemporaryDirectory(prefix='verify-upgrade-capture-') as temporary:
        candidate = Path(temporary) / 'capture.json'
        candidate.write_text(json.dumps(result))
        result['reference_verification'] = verify(candidate)
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'capture': str(destination), 'upgrade_height': height, 'trusted_header_time': signed_time,
                      'kernel_timestamp_ns': decoded['kernel_timestamp_ns'], 'trusted_header_minus_kernel_ns': str(gap)}))


if __name__ == '__main__':
    main()
