#!/usr/bin/env python3
"""Negative controls for the independent rehearsal evidence verifiers."""
import copy
import hashlib
import http.server
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

DIRECTORY = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), DIRECTORY / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

oracle = load('verify-migration-traffic-balances')
traffic = load('migration-rehearsal-traffic')
funding = load('verify-migration-funding')
rehearsal = load('test-populated-migration')


def fixture():
    policy = lambda n: f'{n:056x}'
    genesis = 'a' * 64
    a, b = policy(1) + '41', policy(1) + '42'
    h = {'hostStateNFT': {'policyId': policy(2)}, 'migration': {'generation': '1', 'registryUnit': policy(3) + '01', 'compatibility': 'compatible'},
         'tokens': {'mock': policy(4) + '01'}, 'validators': {name: {'scriptHash': policy(n)} for n, name in
         enumerate(['mintChannelStt', 'mintClientStt', 'mintConnectionStt', 'mintTransferEscrowShard', 'mintVoucher', 'verifyProof'], 10)}}
    h['validators'].update({'spendChannel': {'refValidator': {}}, 'spendClient': {}})
    p = {'genesisSha256': genesis, 'units': [a, b], 'primary': 'primary', 'secondary': 'secondary', 'mintedPerUnit': '1000000'}
    identity = {role + '_policy': h['validators'][key]['scriptHash'] for role, key in
                [('channel', 'mintChannelStt'), ('client', 'mintClientStt'), ('connection', 'mintConnectionStt'), ('escrow', 'mintTransferEscrowShard')]}
    registry = {'phase': 'Ready', 'host_policy': policy(2), 'token': {'policy_id': policy(3), 'name': '01'},
                'current': {'generation': '1', 'compatibility': 'compatible'}, 'identity': identity}
    def utxo(i, assets):
        return {'txHash': f'{i:064x}', 'outputIndex': 0, 'assets': {**{u: str(q) for u, q in assets.items()}, 'lovelace': '2000000'}}
    objects = [{'role': ['host', 'ibc_client/0', 'connection/0', 'channel/0', 'channel/1', 'transfer-root'][i], 'unit': policy(20 + i), 'utxo': utxo(i, {policy(20 + i): 1})} for i in range(6)]
    for i, unit, amount in [(0, a, 11000), (1, b, 7900)]:
        channel = f'channel-{i}'
        nft = identity['escrow_policy'] + oracle.shard_name(channel, unit)
        objects.append({'role': f'escrow/{channel.encode().hex()}/{unit.encode().hex()}', 'unit': nft,
                        'utxo': utxo(10 + i, {nft: 1, unit: amount})})
    voucher = lambda i: h['validators']['mintVoucher']['scriptHash'] + '0014df10' + hashlib.blake2b(f'transfer/channel-{i}/stake'.encode(), digest_size=28).hexdigest()
    remote = lambda i, u: 'ibc/' + hashlib.sha256(f'transfer/channel-{i}/{u}'.encode()).hexdigest().upper()
    s = {'format': 'migration-rehearsal-population-v1', 'genesisSha256': genesis, 'registry': registry, 'objects': objects,
         'wallets': [{'address': 'primary', 'utxos': [utxo(30, {a: 889000, b: 892100, voucher(0): 900000})]},
                     {'address': 'secondary', 'utxos': [utxo(31, {a: 100000, b: 100000, voucher(1): 500000})]}],
         'counterparty': {'chain': 'migration-462-1', 'height': '123', 'address': oracle.COSMOS_ACCOUNT,
                          'balances': [{'denom': remote(0, a), 'amount': '8000'}, {'denom': remote(1, b), 'amount': '7000'},
                                       {'denom': 'stake', 'amount': '99999000000'}, {'denom': 'utest', 'amount': '100000000000'}]}}
    s['counterparty']['escrows'] = [
        {'channel': f'channel-{i}', 'cardanoChannel': f'channel-{i}', 'address': address,
         'balances': [{'denom': 'stake', 'amount': str(amount)}]} for i, address, amount in [
            (0, 'cosmos1a53udazy8ayufvy0s434pfwjcedzqv34kvz9tw', 1123456),
            (1, 'cosmos1kq2rzz6fq2q7fsu75a9g7cpzjeanmk68g99lm5', 500000)]]
    for wallet in s['wallets']:
        for output in wallet['utxos']: output['address'] = wallet['address']
    return s, h, p, ['channel-0', 'channel-1'], 'populated', 1, genesis


class Balances(unittest.TestCase):
    def test_valid_control_and_named_infrastructure(self):
        args = fixture()
        args[0]['wallets'][0]['utxos'][0]['assets'][args[1]['validators']['verifyProof']['scriptHash']] = '3'
        self.assertTrue(oracle.verify(*args)['verified'])

    def test_swapped_shards_preserve_aggregate_but_fail(self):
        args = fixture(); s, _, p, *_ = args
        a, b = p['units']
        first, second = s['objects'][-2:]
        del first['utxo']['assets'][a]; del second['utxo']['assets'][b]
        first['utxo']['assets'][b] = '7900'; second['utxo']['assets'][a] = '11000'
        with self.assertRaisesRegex(ValueError, 'per-shard'):
            oracle.verify(*args)

    def test_wrong_shard_nft_and_extra_principal(self):
        for mutation in ['nft', 'principal', 'outref', 'genesis', 'generation', 'remote', 'role', 'holder', 'wallet_outref', 'remote_backing', 'remote_address']:
            with self.subTest(mutation=mutation):
                args = fixture(); s = args[0]
                if mutation == 'nft':
                    o = s['objects'][-1]; old = o['unit']; o['unit'] = 'f' * 112
                    o['utxo']['assets'][o['unit']] = o['utxo']['assets'].pop(old)
                elif mutation == 'principal': s['objects'][-1]['utxo']['assets']['f' * 56] = '1'
                elif mutation == 'outref': s['objects'][-1]['utxo']['txHash'] = s['objects'][-2]['utxo']['txHash']
                elif mutation == 'genesis': s['genesisSha256'] = 'b' * 64
                elif mutation == 'generation': s['registry']['current']['generation'] = '2'
                elif mutation == 'role': s['objects'][0]['role'] = s['objects'][-1]['role']
                elif mutation == 'holder': s['wallets'][0]['utxos'][0]['address'] = 'another-holder'
                elif mutation == 'wallet_outref': s['wallets'][0]['utxos'][0]['txHash'] = s['objects'][0]['utxo']['txHash']
                elif mutation == 'remote_backing': s['counterparty']['escrows'][0]['balances'][0]['amount'] = '1123455'
                elif mutation == 'remote_address': s['counterparty']['escrows'][0]['address'] = s['counterparty']['escrows'][1]['address']
                else: s['counterparty']['address'] = 'another-holder'
                with self.assertRaises(ValueError): oracle.verify(*args)

    def test_checks_survive_python_optimization(self):
        args = fixture()
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for name, value in zip(['snapshot', 'handler', 'population'], args[:3]):
                path = Path(directory) / (name + '.json'); path.write_text(json.dumps(value)); paths.append(str(path))
            command = [sys.executable, '-O', str(DIRECTORY / 'verify-migration-traffic-balances.py'),
                       '--snapshot', paths[0], '--handler', paths[1], '--wallet-population', paths[2],
                       '--cosmos-channels', *args[3], '--phase', args[4], '--generation', '1', '--genesis-sha256', args[6]]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            args[0]['wallets'][0]['utxos'][0]['assets'][args[2]['units'][0]] = '889001'
            Path(paths[0]).write_text(json.dumps(args[0]))
            bad = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn('Primary principal/voucher balance', bad.stderr)


class PacketEvidence(unittest.TestCase):
    def test_read_failure_retry_refuses_any_build_or_submission_evidence(self):
        failed = json.dumps({'status': 'error', 'result': 'failed querying latest status of the destination chain: query_header failed'})
        traffic.require_failed_before_build(failed)
        traffic.require_failed_before_build(json.dumps({'status': 'error', 'result':
            "link initialization failed during channel counterparty verification: failed during a query to chain 'cardano-devnet': Not found: UTxO"}))
        for message in ['Building unsigned transaction', 'Trusted node accepted transaction', 'Transaction submitted',
                        'probabilistic checkpoint committed', 'assembled batch of 3 messages', 'broadcast failed']:
            with self.subTest(message=message), self.assertRaisesRegex(RuntimeError, 'constructed or submitted'):
                traffic.require_failed_before_build(json.dumps({'fields': {'message': message}}) + '\n' + failed)
        for outcome in [{'status': 'success', 'result': []}, {'status': 'error', 'result': 'unknown network failure'}]:
            with self.subTest(outcome=outcome), self.assertRaises(RuntimeError):
                traffic.require_failed_before_build(json.dumps(outcome))

    def test_exact_timestamp_and_cosmos_event_negative_controls(self):
        self.assertEqual(traffic.timestamp_ns('2026-01-01T00:00:00.123456789Z'), 1767225600123456789)
        packet = {'sequence': 1, 'source_channel': 'channel-0', 'destination_channel': 'channel-1',
                  'source_port': 'transfer', 'destination_port': 'transfer', 'data': 'abcd',
                  'timeout_height': {'revision_number': 0, 'revision_height': 0},
                  'timeout_timestamp': {'time': '2026-01-01T00:00:00.123456789Z'}}
        attributes = traffic.packet_attributes(packet, 'WriteAcknowledgement')
        transaction = {'code': 0, 'events': [{'type': 'write_acknowledgement', 'attributes':
                       [{'key': k, 'value': v} for k, v in attributes.items()]}]}
        self.assertTrue(traffic.matching_cosmos_event(transaction, packet, 'WriteAcknowledgement'))
        for key in attributes:
            corrupted = copy.deepcopy(transaction)
            next(item for item in corrupted['events'][0]['attributes'] if item['key'] == key)['value'] = 'wrong'
            with self.subTest(key=key):
                self.assertFalse(traffic.matching_cosmos_event(corrupted, packet, 'WriteAcknowledgement'))
        transaction['code'] = 1
        self.assertFalse(traffic.matching_cosmos_event(transaction, packet, 'WriteAcknowledgement'))
        transaction['code'] = 0
        next(a for a in transaction['events'][0]['attributes'] if a['key'] == 'packet_src_port')['value'] = 'TRANSFER'
        self.assertFalse(traffic.matching_cosmos_event(transaction, packet, 'WriteAcknowledgement'))
        acknowledgement = {'code': 0, 'events': [{'type': 'acknowledge_packet', 'attributes':
            [{'key': k, 'value': v} for k, v in traffic.packet_attributes(packet, 'AcknowledgePacket').items()]}]}
        self.assertNotIn('packet_data_hex', traffic.packet_attributes(packet, 'AcknowledgePacket'))
        self.assertTrue(traffic.matching_cosmos_event(acknowledgement, packet, 'AcknowledgePacket'))
        acknowledgement['events'].append(copy.deepcopy(acknowledgement['events'][0]))
        self.assertFalse(traffic.matching_cosmos_event(acknowledgement, packet, 'AcknowledgePacket'))


class RehearsalEvidence(unittest.TestCase):
    def test_readiness_retains_real_http_503_explanation(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_GET(self):
                status = 200 if self.path == '/ready' else 503
                body = (b'{"status":"ready"}' if self.path == '/ready' else
                        b'{"status":"not_ready","cause":"No qualified genesis pools"}')
                if self.path == '/invalid': body = b'not JSON'
                if self.path == '/oversize': body = b'x' * 65537
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = 'http://127.0.0.1:' + str(server.server_address[1])
                self.assertEqual(rehearsal.read_gateway_readiness(url + '/blocked'), {
                    'httpStatus': 503, 'body': {'status': 'not_ready', 'cause': 'No qualified genesis pools'}})
                self.assertEqual(rehearsal.read_gateway_readiness(url + '/ready'), {
                    'httpStatus': 200, 'body': {'status': 'ready'}})
                self.assertIn('error', rehearsal.read_gateway_readiness(url + '/invalid'))
                self.assertIn('64 KiB', rehearsal.read_gateway_readiness(url + '/oversize')['error'])
            finally:
                server.shutdown()
                worker.join(timeout=5)

    def test_counterparty_catch_up_checks_actual_height_without_swallowing_errors(self):
        state = {'client_state': {'@type': '/ibc.lightclients.probabilistic.v1.ClientState',
                                 'latest_height': {'revision_number': '0', 'revision_height': '2278'}}}
        self.assertFalse(rehearsal.counterparty_needs_update(state, '2278'))
        self.assertTrue(rehearsal.counterparty_needs_update(state, '2280'))
        for accepted in ['2277', '0']:
            with self.subTest(accepted=accepted), self.assertRaises(RuntimeError):
                rehearsal.counterparty_needs_update(state, accepted)
        for key, value in [('@type', '/another.ClientState'),
                           ('latest_height', {'revision_number': '1', 'revision_height': '2278'})]:
            wrong = copy.deepcopy(state)
            wrong['client_state'][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                rehearsal.counterparty_needs_update(wrong, '2278')

    def test_old_packet_proof_must_follow_the_selected_activation(self):
        message = {'proofHeight': '1744', 'packetMessageVerified': True, 'transactionHash': 'a' * 64, 'messageIndex': 1}
        activation = {'inclusion': {'block': '1633'}}
        self.assertEqual(rehearsal.bind_counterparty_continuity(2, {'packetMessages': [message]}, activation)['proofHeight'], '1744')
        for messages in [[], [message, message], [{**message, 'proofHeight': '924'}], [{**message, 'packetMessageVerified': False}]]:
            with self.subTest(messages=messages), self.assertRaisesRegex(RuntimeError, 'post-activation'):
                rehearsal.bind_counterparty_continuity(2, {'packetMessages': messages}, activation)

    def test_occupied_gateway_fails_preflight(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, 'occupied'):
                rehearsal.preflight_gateway_ports([port])
        rehearsal.preflight_gateway_ports([port])

    def test_handover_inventory_must_identify_the_selected_successor(self):
        handler = Path('/owned/handler-v2.json')
        valid = {'format': 'populated-migration-handover-v1', 'generation': 2,
                 'handler': str(handler), 'transactions': ['a' * 64, 'b' * 64]}
        self.assertEqual(rehearsal.handover_transactions(valid, 2, handler), valid['transactions'])
        for key, value in [('format', 'unrelated'), ('generation', 3), ('handler', '/another/handler-v2.json'),
                           ('transactions', []), ('transactions', ['a' * 64, 'a' * 64]),
                           ('transactions', ['not-a-transaction']), ('transactions', [None])]:
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                rehearsal.handover_transactions({**valid, key: value}, 2, handler)

    def test_relabelled_v2_evidence_cannot_prove_v3_handover(self):
        roles = ['hostStateStt', 'spendClient', 'spendConnection', 'spendChannel', 'spendTransferModule']
        def handler(generation):
            return {'migration': {'registryUnit': 'registry', 'generation': generation, 'compatibility': 'abi'},
                    'hostStateNFT': {'policyId': 'host', 'name': 'nft'},
                    'validators': {role: {'scriptHash': f'{generation * 10 + i:056x}'} for i, role in enumerate(roles)}}
        def snapshot(h):
            return {'genesisSha256': 'genesis', 'registry': {'token': {'policy_id': 'reg', 'name': 'istry'},
                    'host_policy': 'host', 'current': {'generation': h['migration']['generation'], 'compatibility': 'abi',
                    'addresses': [{'payment_credential': {'Script': [h['validators'][r]['scriptHash']]},
                                   'stake_credential': None} for r in roles]}}}
        h1, h2, h3 = [handler(g) for g in [1, 2, 3]]
        before, approved, after = snapshot(h1), snapshot(h1), snapshot(h2)
        rehearsal.bind_handover_snapshots(before, approved, after, h1, h2, 2, 'genesis')
        with self.assertRaisesRegex(RuntimeError, 'generation'):
            rehearsal.bind_handover_snapshots(before, approved, after, h2, h3, 3, 'genesis')
        for mutation in ['generation', 'genesis', 'registry', 'credential', 'stake', 'compatibility']:
            changed = copy.deepcopy(after)
            if mutation == 'generation': changed['registry']['current']['generation'] = 3
            elif mutation == 'genesis': changed['genesisSha256'] = 'unrelated'
            elif mutation == 'registry': changed['registry']['token']['name'] = 'other'
            elif mutation == 'credential': changed['registry']['current']['addresses'][0]['payment_credential']['Script'][0] = 'substituted'
            elif mutation == 'stake': changed['registry']['current']['addresses'][0]['stake_credential'] = {'Inline': {'VerificationKey': ['other']}}
            elif mutation == 'compatibility': changed['registry']['current']['compatibility'] = 'other'
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                rehearsal.bind_handover_snapshots(before, approved, changed, h1, h2, 2, 'genesis')


class FundingEvidence(unittest.TestCase):
    def test_external_payer_and_signature_controls(self):
        holder = 'addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m'
        payer = 'addr_test1vpmudxv36hnwejmdepu8a4mprs42d3gzzhzsl73uvv73aksj5nvtm'
        same_key_base_address = 'addr_test1qpmudxv36hnwejmdepu8a4mprs42d3gzzhzsl73uvv73aksjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfq0q8gd0'
        credential = '77c69991d5e6eccb6dc8787ed7611c2aa6c50215c50ffa3c633d1eda'
        def snapshot(generation, balance, deposit):
            return {'genesisSha256': 'a' * 64,
                    'registry': {'phase': {'Proposed': {}} if generation == 1 else 'Ready',
                                 'nonce': '1', 'current': {'generation': generation},
                                 'token': {'policy_id': 'reg', 'name': 'istry'},
                                 'governance': {'signers': ['authority']}},
                    'wallets': [{'address': holder}],
                    'executor': {'address': payer, 'credential': credential, 'utxos': [
                        {'txHash': 'wallet', 'outputIndex': 0, 'address': payer, 'assets': {'lovelace': str(balance)}}]},
                    'objects': [{'unit': 'object', 'role': 'object', 'utxo': {
                        'txHash': 'source' if generation == 1 else 'move', 'outputIndex': 0,
                        'address': 'source-script' if generation == 1 else 'target-script',
                        'assets': {'lovelace': '20', 'object': '1', 'principal': '100'}}}],
                    'registryUtxo': {'txHash': 'approval' if generation == 1 else 'activate', 'outputIndex': 0,
                                     'address': 'registry-script', 'assets': {'lovelace': str(deposit), 'registry': '1'}}}
        before, after = snapshot(1, 100, 20), snapshot(2, 75, 25)
        reports = [{'transaction': tx, 'genesisSha256': 'a' * 64, 'signingKeyHashes': [credential],
                    'bootstrapWitnessCount': 0, 'minted': {}, 'feeLovelace': '10',
                    'reconstructedTransactionBytes': 100, 'memory': '10', 'steps': '10',
                    'limits': {'bytes': 1000, 'memory': 100, 'steps': 100}} for tx in ['move', 'activate']]
        middle = {**after['registryUtxo'], 'txHash': 'move', 'outputIndex': 1}
        reports[0].update(inputs=[{'txHash': 'approval', 'outputIndex': 0}],
                          outputs=[after['objects'][0]['utxo'], middle])
        reports[1].update(inputs=[{'txHash': 'move', 'outputIndex': 1}], outputs=[after['registryUtxo']])
        self.assertEqual(funding.verify(before, after, reports)['externalPayerSpentLovelace'], '25')
        self.assertEqual(funding.payment_key(payer), credential)
        self.assertNotEqual(payer, same_key_base_address)
        self.assertEqual(funding.payment_key(same_key_base_address), credential)
        for mutation in ['signature', 'extra_payment', 'mint', 'omission', 'duplicate', 'deposit', 'authority',
                         'budget', 'bootstrap', 'unrelated_begin', 'principal', 'offsetting_deposits', 'holder_key']:
            b, a, r = copy.deepcopy([before, after, reports])
            if mutation == 'signature': r[0]['signingKeyHashes'].append('holder')
            elif mutation == 'extra_payment': a['executor']['utxos'][0]['assets']['lovelace'] = '74'
            elif mutation == 'mint': r[0]['minted'] = {'voucher': '1'}
            elif mutation == 'omission': r.pop()
            elif mutation == 'duplicate': r[1] = copy.deepcopy(r[0])
            elif mutation == 'deposit': a['registryUtxo']['assets']['lovelace'] = '19'
            elif mutation == 'authority': b['registry']['governance']['signers'].append(credential)
            elif mutation == 'budget': r[0]['memory'] = '101'
            elif mutation == 'bootstrap': r[0]['bootstrapWitnessCount'] = 1
            elif mutation == 'unrelated_begin': r[0]['inputs'][0]['txHash'] = 'unrelated'
            elif mutation == 'principal': a['objects'][0]['utxo']['assets']['principal'] = '99'
            elif mutation == 'offsetting_deposits':
                a['objects'][0]['utxo']['assets']['lovelace'] = '19'
                a['registryUtxo']['assets']['lovelace'] = '26'
            elif mutation == 'holder_key': b['wallets'][0]['address'] = same_key_base_address
            with self.subTest(mutation=mutation):
                intended = {'unrelated_begin': 'registry continuation', 'holder_key': 'holder is the executor',
                            'principal': 'Per-object principal', 'offsetting_deposits': 'Per-object infrastructure',
                            'bootstrap': 'bootstrap signature'}
                with self.assertRaisesRegex(ValueError, intended.get(mutation, '.')):
                    funding.verify(b, a, r)


class RehearsalAuthorityTests(unittest.TestCase):
    def test_current_explicit_fixture_and_no_permissive_fallback(self):
        value = {'signers': ['8f310f79f977bdf0befedfae3374a625e64c9a69a40c3c8fca607dac'],
                 'quorum': '1', 'delay_ms': '86400000',
                 'emergency': {'signers': ['832616310bff22a9f1519fc81916b3c6b8ba93324817f24544b8f6cd'], 'quorum': '1'}}
        self.assertEqual(rehearsal.rehearsal_governance(value), value)
        for change in [lambda x: x.pop('emergency'),
                       lambda x: x.update(delay_ms='0'),
                       lambda x: x['emergency'].update(signers=x['signers']),
                       lambda x: x['emergency'].update(quorum='0')]:
            bad = copy.deepcopy(value)
            change(bad)
            with self.assertRaisesRegex(RuntimeError, 'public rehearsal governance'):
                rehearsal.rehearsal_governance(bad)


if __name__ == '__main__':
    unittest.main()
