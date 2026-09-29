#!/usr/bin/env python3
"""Independent fixed-flow accounting oracle; packet proof acceptance is separate.

Only ADA, named implementation operation tokens and the deployment mock token
are infrastructure. Every other wallet asset and every escrow asset is checked.
Checks remain active under python -O. No implementation accounting is imported.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

COSMOS_ACCOUNT = 'cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def shard_name(channel, denom):
    fields = [channel.encode(), denom.encode()]
    raw = b'cardano-ibc/transfer-escrow-shard/v1\0'
    raw += b''.join(len(field).to_bytes(4, 'big') + field for field in fields)
    return hashlib.blake2b(raw, digest_size=28).hexdigest()


def cosmos_address_bytes(address):
    # Strict BIP-173 decode; this oracle does not import the transfer SDK's
    # escrow-address helper or reuse its queried answer as the expectation.
    charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    require(address.startswith('cosmos1') and len(address) == 45, 'Cosmos escrow address format')
    require(all(c in charset for c in address[7:]), 'Cosmos escrow address alphabet')
    values = [charset.index(c) for c in address[7:]]
    hrp = 'cosmos'
    expanded = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]
    checksum = 1
    for value in expanded + values:
        top = checksum >> 25
        checksum = ((checksum & 0x1ffffff) << 5) ^ value
        for index, generator in enumerate([0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]):
            if top >> index & 1:
                checksum ^= generator
    require(checksum == 1, 'Cosmos escrow checksum')
    accumulator, bits, decoded = 0, 0, []
    for value in values[:-6]:
        accumulator = (accumulator << 5) | value
        bits += 5
        while bits >= 8:
            bits -= 8
            decoded.append((accumulator >> bits) & 255)
    require(bits == 0 and len(decoded) == 20, 'Cosmos escrow payload width')
    return bytes(decoded)


def verify(snapshot, handler, population, channels, phase, generation, genesis_sha):
    require(snapshot['format'] == 'migration-rehearsal-population-v1', 'Snapshot format')
    require(re.fullmatch('[a-f0-9]{64}', genesis_sha) is not None, 'Genesis hash format')
    require(snapshot['genesisSha256'] == population['genesisSha256'] == genesis_sha, 'Genesis provenance')
    require(len(channels) == len(set(channels)) == 2 and
            all(re.fullmatch(r'channel-\d+', c) for c in channels), 'Distinct counterparty routes required')
    registry = snapshot['registry']
    require(registry['phase'] == 'Ready', 'Registry must be active')
    require(int(registry['current']['generation']) == int(handler['migration']['generation']) == generation,
            'Generation provenance')
    require(registry['host_policy'] == handler['hostStateNFT']['policyId'], 'Host identity')
    require(registry['token']['policy_id'] + registry['token']['name'] == handler['migration']['registryUnit'],
            'Registry identity')
    require(registry['current']['compatibility'] == handler['migration']['compatibility'], 'Compatibility identity')
    for role, key in [('channel', 'mintChannelStt'), ('client', 'mintClientStt'),
                      ('connection', 'mintConnectionStt'), ('escrow', 'mintTransferEscrowShard')]:
        require(registry['identity'][role + '_policy'] == handler['validators'][key]['scriptHash'], role + ' identity')
    counterparty = snapshot['counterparty']
    require(counterparty['chain'] == 'migration-462-1' and counterparty['address'] == COSMOS_ACCOUNT
            and re.fullmatch('[1-9][0-9]*', str(counterparty['height'])), 'Counterparty provenance')
    require(len(snapshot['wallets']) == 2 and len(snapshot['objects']) == 8, 'Complete fixed population required')
    objects = snapshot['objects']
    require(len({o['unit'] for o in objects}) == 8, 'Duplicate state NFT')
    require(len({o['role'] for o in objects}) == 8, 'Duplicate state role')
    require(len({(o['utxo']['txHash'], o['utxo']['outputIndex']) for o in objects}) == 8, 'Duplicate state outref')
    for obj in objects:
        require(int(obj['utxo']['assets'].get(obj['unit'], 0)) == 1, 'Missing unique object token')
    asset_a, asset_b = population['units']
    require(asset_a != asset_b and population['mintedPerUnit'] == '1000000', 'Fixture asset identity')
    policy = handler['validators']['mintVoucher']['scriptHash']
    def voucher(channel):
        return policy + '0014df10' + hashlib.blake2b(f'transfer/{channel}/stake'.encode(), digest_size=28).hexdigest()
    primary_unit, secondary_unit = voucher('channel-0'), voucher('channel-1')
    def cosmos_denom(channel, unit):
        return 'ibc/' + hashlib.sha256(f'transfer/{channel}/{unit}'.encode()).hexdigest().upper()
    cosmos_a, cosmos_b = cosmos_denom(channels[0], asset_a), cosmos_denom(channels[1], asset_b)
    infrastructure = {handler['tokens']['mock'], handler['validators']['verifyProof']['scriptHash']}
    infrastructure.update(v['scriptHash'] for v in handler['validators']['spendChannel']['refValidator'].values())
    # Staged client verification tokens, if present, are explicitly named by the handler.
    client = handler['validators']['spendClient']
    infrastructure.update(v['scriptHash'] for v in client.get('refValidator', {}).values())

    seen = {(o['utxo']['txHash'], o['utxo']['outputIndex']) for o in objects}

    def sum_assets(utxos, address):
        total = {}
        for utxo in utxos:
            require(utxo['address'] == address, 'Wallet output has another holder address')
            ref = (utxo['txHash'], utxo['outputIndex'])
            require(ref not in seen, 'Duplicate population outref')
            seen.add(ref)
            for unit, quantity in utxo['assets'].items():
                require(int(quantity) > 0, 'Nonpositive output asset')
                if unit != 'lovelace' and unit not in infrastructure:
                    total[unit] = total.get(unit, 0) + int(quantity)
        return total

    wallets = {wallet['address']: sum_assets(wallet['utxos'], wallet['address']) for wallet in snapshot['wallets']}
    require(set(wallets) == {population['primary'], population['secondary']}, 'Holder identities')
    remote = {b['denom']: int(b['amount']) for b in counterparty['balances'] if b['denom'] != 'stake'}
    require(len({b['denom'] for b in counterparty['balances']}) == len(counterparty['balances']), 'Duplicate remote denom')
    if phase == 'populated':
        expected_primary = {asset_a: 900000 - 10000 - 1000,
                            asset_b: 900000 - 7000 - 900, primary_unit: 1000000 - 100000}
        expected_escrow = {asset_a: 10000 + 1000, asset_b: 7000 + 900}
        expected_remote = {cosmos_a: 10000 - 2000, cosmos_b: 7000}
    elif phase in ['settled', 'settled-v3']:
        expected_primary = {asset_a: 900000 - 10000 + 2000 - 333,
                            asset_b: 900000 - 7000 - 900, primary_unit: 1000000 + 123456 - 5000}
        expected_escrow = {asset_a: 10000 - 2000 + 333, asset_b: 7000 + 900}
        expected_remote = {cosmos_a: expected_escrow[asset_a], cosmos_b: expected_escrow[asset_b]}
    else:
        raise ValueError('Unsupported fixed-flow phase')
    if phase == 'settled-v3':
        expected_primary[asset_b] -= 444
        expected_escrow[asset_b] += 444
        expected_remote[cosmos_b] += 444
    require(wallets[population['primary']] == expected_primary, 'Primary principal/voucher balance')
    require(wallets[population['secondary']] == {asset_a: 100000, asset_b: 100000, secondary_unit: 500000 + (777 if phase == 'settled-v3' else 0)},
            'Secondary principal/voucher balance')
    escrow = {o['role']: o for o in objects if o['role'].startswith('escrow/')}
    expected_roles = {f'escrow/{channel.encode().hex()}/{unit.encode().hex()}': (channel, unit)
                      for channel, unit in [('channel-0', asset_a), ('channel-1', asset_b)]}
    require({o['role'] for o in objects} == set(expected_roles) |
            {'host', 'ibc_client/0', 'connection/0', 'channel/0', 'channel/1', 'transfer-root'},
            'Exact complete role inventory required')
    require(set(escrow) == set(expected_roles), 'Exact escrow shards required')
    for role, (channel, unit) in expected_roles.items():
        obj = escrow[role]
        token = registry['identity']['escrow_policy'] + shard_name(channel, unit)
        require(obj['unit'] == token, 'Escrow NFT does not authenticate its channel/denom')
        actual = {u: int(q) for u, q in obj['utxo']['assets'].items() if u != 'lovelace'}
        require(actual == {token: 1, unit: expected_escrow[unit]}, 'Exact per-shard backing and NFT required')
    # The public Cosmos fixture also starts with an unrelated utest balance.
    # Check its exact unchanged amount rather than excluding unknown denoms.
    require(remote == {**expected_remote, 'utest': 100000000000}, 'Exact remote voucher balances')
    remote_escrows = counterparty['escrows']
    require(len(remote_escrows) == 2 and {e['channel'] for e in remote_escrows} == set(channels),
            'Complete distinct counterparty escrow inventory')
    expected_foreign_backing = [1123456 if phase == 'populated' else 1118456,
                               500000 + (777 if phase == 'settled-v3' else 0)]
    for index, channel in enumerate(channels):
        observed = next(e for e in remote_escrows if e['channel'] == channel)
        require(observed['cardanoChannel'] == f'channel-{index}', 'Counterparty escrow route')
        require(cosmos_address_bytes(observed['address']) == hashlib.sha256(
            f'ics20-1\0transfer/{channel}'.encode()).digest()[:20], 'Counterparty escrow address identity')
        require(observed['balances'] == [{'denom': 'stake', 'amount': str(expected_foreign_backing[index])}],
                'Original foreign-native escrow backing')
    return {'verified': True, 'phase': phase, 'generation': generation, 'voucherUnits': [primary_unit, secondary_unit],
            'nativeBacking': expected_escrow,
            'scope': 'Independent holder/principal arithmetic; packet acceptance and authenticated capture evidenced separately'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot', type=Path, required=True)
    p.add_argument('--handler', type=Path, required=True)
    p.add_argument('--wallet-population', type=Path, required=True)
    p.add_argument('--cosmos-channels', nargs=2, required=True)
    p.add_argument('--phase', choices=['populated', 'settled', 'settled-v3'], required=True)
    p.add_argument('--generation', type=int, required=True)
    p.add_argument('--genesis-sha256', required=True)
    args = p.parse_args()
    documents = [json.loads(path.read_text()) for path in (args.snapshot, args.handler, args.wallet_population)]
    print(json.dumps(verify(*documents, args.cosmos_channels, args.phase, args.generation, args.genesis_sha256)))


if __name__ == '__main__':
    main()
