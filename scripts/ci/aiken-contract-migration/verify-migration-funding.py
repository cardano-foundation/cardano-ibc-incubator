#!/usr/bin/env python3
"""Reconcile canonical handover fees/deposits against a separate ADA-only payer.

Inputs are read-only population captures and canonical transaction measurements.
Canonical inclusion and script acceptance are checked by their capture tools;
this independent arithmetic check is not a finality certificate.
"""
import argparse
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def payment_key(address):
    """Independent BIP-173 decode for the rehearsal's Shelley key addresses."""
    charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    require(address.startswith('addr_test1'), 'Expected Shelley testnet holder address')
    hrp, encoded = address.rsplit('1', 1)
    require(hrp == 'addr_test' and len(encoded) >= 6 and all(c in charset for c in encoded), 'Address alphabet')
    values = [charset.index(c) for c in encoded]
    checksum = 1
    for value in [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + values:
        top = checksum >> 25
        checksum = ((checksum & 0x1ffffff) << 5) ^ value
        for index, generator in enumerate([0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]):
            if top >> index & 1: checksum ^= generator
    require(checksum == 1, 'Address checksum')
    accumulator, bits, payload = 0, 0, []
    for value in values[:-6]:
        accumulator = (accumulator << 5) | value
        bits += 5
        while bits >= 8:
            bits -= 8
            payload.append((accumulator >> bits) & 255)
    require(bits < 5 and accumulator & ((1 << bits) - 1) == 0, 'Address padding')
    require(payload and payload[0] & 15 == 0 and
            ((payload[0] >> 4 == 6 and len(payload) == 29) or
             (payload[0] >> 4 in [0, 2] and len(payload) == 57)), 'Unsupported address type/network')
    return bytes(payload[1:29]).hex()


def verify(before, after, reports):
    require(before['genesisSha256'] == after['genesisSha256'], 'Genesis changed')
    require(isinstance(before['registry']['phase'], dict) and
            'Proposed' in before['registry']['phase'] and after['registry']['phase'] == 'Ready',
            'Funding capture must begin after approval and end after activation')
    require(before['registry']['nonce'] == after['registry']['nonce'], 'Approval changed during execution')
    require(int(after['registry']['current']['generation']) ==
            int(before['registry']['current']['generation']) + 1, 'Not one handover')
    old, new = before['executor'], after['executor']
    require(old['address'] == new['address'] and old['credential'] == new['credential'],
            'Executor identity changed')
    require(payment_key(old['address']) == old['credential'], 'Executor payment credential')
    for snapshot in [before, after]:
        require(old['credential'] not in [payment_key(w['address']) for w in snapshot['wallets']],
                'A holder is the executor')
        require(old['credential'] not in snapshot['registry']['governance']['signers'],
                'Executor has governance authority')
    require(len(reports) == len(before['objects']) + 1, 'Expected Begin, each object move and activation')
    hashes = {report['transaction'] for report in reports}
    require(len(hashes) == len(reports), 'Duplicate migration transaction')
    require(all(o['utxo']['txHash'] in hashes for o in after['objects']) and
            after['registryUtxo']['txHash'] in hashes, 'Reports omit final custody outputs')
    def outref(utxo):
        return utxo['txHash'], utxo['outputIndex']
    token = before['registry']['token']
    require(token == after['registry']['token'], 'Registry identity changed')
    unit = token['policy_id'] + token['name']
    cursor = outref(before['registryUtxo'])
    remaining = list(reports)
    while remaining:
        matches = [r for r in remaining if cursor in [outref(i) for i in r['inputs']]]
        require(len(matches) == 1, 'Missing or ambiguous canonical registry continuation')
        report = matches[0]
        destinations = [o for o in report['outputs'] if int(o['assets'].get(unit, 0)) != 0]
        require(len(destinations) == 1 and int(destinations[0]['assets'][unit]) == 1 and
                destinations[0]['txHash'] == report['transaction'] and
                destinations[0]['address'] == before['registryUtxo']['address'], 'Registry token continuation')
        cursor = outref(destinations[0])
        remaining.remove(report)
    require(cursor == outref(after['registryUtxo']), 'Registry chain does not reach activated custody')
    for utxo in [after['registryUtxo'], *[o['utxo'] for o in after['objects']]]:
        outputs = [o for report in reports for o in report['outputs'] if outref(o) == outref(utxo)]
        require(len(outputs) == 1 and outputs[0]['address'] == utxo['address'] and
                outputs[0]['assets'] == utxo['assets'], 'Captured custody differs from measured output')
    fees = 0
    for report in reports:
        require(report['genesisSha256'] == before['genesisSha256'], 'Transaction report genesis changed')
        require(report['signingKeyHashes'] == [old['credential']], 'Holder/authority or unexpected signature')
        require(report['bootstrapWitnessCount'] == 0, 'Unexpected bootstrap signature')
        require(report['minted'] == {}, 'Handover minted or burned assets')
        fees += int(report['feeLovelace'])
        require(int(report['feeLovelace']) > 0, 'Invalid fee')
        require(0 < report['reconstructedTransactionBytes'] <= report['limits']['bytes'], 'Transaction size')
        for field in ['memory', 'steps']:
            require(0 < int(report[field]) <= int(report['limits'][field]), 'Transaction execution budget')

    def wallet_ada(wallet):
        refs = {(u['txHash'], u['outputIndex']) for u in wallet['utxos']}
        require(len(refs) == len(wallet['utxos']), 'Duplicate executor output')
        for utxo in wallet['utxos']:
            require(utxo['address'] == wallet['address'] and set(utxo['assets']) == {'lovelace'}
                    and int(utxo['assets']['lovelace']) > 0, 'Executor must contain only external ADA')
        return sum(int(u['assets']['lovelace']) for u in wallet['utxos'])

    def deposits(snapshot):
        return sum(int(o['utxo']['assets']['lovelace']) for o in snapshot['objects']) + \
            int(snapshot['registryUtxo']['assets']['lovelace'])

    for snapshot in [before, after]:
        outputs = [snapshot['registryUtxo'], *[o['utxo'] for o in snapshot['objects']], *snapshot['executor']['utxos']]
        require(len({outref(o) for o in outputs}) == len(outputs), 'Duplicate population outref')
    old_objects = {o['unit']: o for o in before['objects']}
    new_objects = {o['unit']: o for o in after['objects']}
    require(len(old_objects) == len(before['objects']) == len(after['objects']) == len(new_objects) and
            old_objects.keys() == new_objects.keys(), 'Object identity inventory changed')
    pairs = [(before['registryUtxo'], after['registryUtxo'])]
    for token, obj in old_objects.items():
        successor = new_objects[token]
        require(obj['role'] == successor['role'] and int(obj['utxo']['assets'].get(token, 0)) == 1,
                'Object role or authentication token changed')
        pairs.append((obj['utxo'], successor['utxo']))
    for original, successor in pairs:
        principal = lambda output: {u: int(q) for u, q in output['assets'].items() if u != 'lovelace'}
        require(principal(original) == principal(successor), 'Per-object principal/state-token loss')
        require(int(successor['assets']['lovelace']) >= int(original['assets']['lovelace']), 'Per-object infrastructure decrease')
    increase = deposits(after) - deposits(before)
    require(increase >= 0, 'Infrastructure deposits decreased')
    spent = wallet_ada(old) - wallet_ada(new)
    require(spent == fees + increase, 'External payer delta differs from fees plus infrastructure increase')
    return {'verified': True, 'transactions': len(reports), 'executor': old['address'],
            'feesLovelace': str(fees), 'infrastructureIncreaseLovelace': str(increase),
            'externalPayerSpentLovelace': str(spent),
            'scope': 'Handover only; governance approval and reference publication are separate costs'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('reports', type=Path, nargs='+')
    args = parser.parse_args()
    read = lambda path: json.loads(path.read_text())
    print(json.dumps(verify(read(args.before), read(args.after), [read(p) for p in args.reports])))


if __name__ == '__main__':
    main()
