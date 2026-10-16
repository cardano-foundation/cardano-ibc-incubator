#!/usr/bin/env python3
"""Live CometBFT rehearsal with the native application and production relayer paths."""
import argparse
import base64
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from harness import Node, read, write, write_text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--node-image', required=True)
    parser.add_argument('--probe-image', required=True)
    parser.add_argument('--worker', type=Path, required=True)
    parser.add_argument('--aggregator', type=Path, required=True)
    parser.add_argument('--rpc-port', type=int, default=18957)
    parser.add_argument('--grpc-port', type=int, default=19090)
    parser.add_argument('--gateway-port', type=int, default=15001)
    parser.add_argument('--scenario', default='readiness')
    args = parser.parse_args()
    root = args.output.resolve()
    repo = Path(__file__).resolve().parents[2]
    children = []
    node = None
    profile = read(Path(__file__).with_name('readiness-profile.json'))
    result = {'production_gate_closed': False, 'comet_clock': 'unmodified', 'source': 'locally signed synthetic Cardano history', 'trusting_period_seconds': 172800}
    if args.resume and (root/'readiness-result.json').exists():
        result = read(root/'readiness-result.json')
    result.pop('complete', None)
    result['production_gate_closed'] = False
    result['unverified_production_gates'] = profile['unverified_production_gates']
    write(root/'readiness-profile.json', profile)
    write(root/'readiness-result.json', result)

    def mark(name, value=True):
        result[name] = value
        write(root/'readiness-result.json', result)
        print(name, json.dumps(value), flush=True)

    def wait(predicate, seconds=120):
        until = time.monotonic()+seconds
        while time.monotonic() < until:
            value = predicate()
            if value:
                return value
            time.sleep(.5)
        raise RuntimeError('Timed out waiting for committed progress')

    def child(command, name, env=None, input=None):
        log = (root/(name+'.log')).open('a')
        process = subprocess.Popen(command, cwd=repo/'cardano/gateway', env=env or dict(os.environ, RUST_LOG='info'), stdin=subprocess.PIPE if input else None, stdout=log, stderr=subprocess.STDOUT)
        if input:
            process.stdin.write(input)
            process.stdin.close()
        children.append(process)
        return process

    def helper(*command):
        return subprocess.check_output(['docker', 'run', '--rm', '-v', f'{root}:/out', args.probe_image, *command], text=True)

    def start_node():
        subprocess.run(['docker', 'run', '-d', '--name', node.name, '-p', f'127.0.0.1:{args.rpc_port}:26657', '-p', f'127.0.0.1:{args.grpc_port}:9900', '-v', f'{root}:/out', '-e', 'GOMEMLIMIT=768MiB', '-e', 'GOGC=50', args.node_image, 'start', '--home', '/out/'+node.home.name, '--rpc.laddr', 'tcp://0.0.0.0:26657', '--minimum-gas-prices', '500000000inj'], check=True, stdout=subprocess.DEVNULL)
        node.running = True
        def started():
            try:
                return int(node.rpc('status')['sync_info']['latest_block_height']) >= 2
            except (OSError, RuntimeError):
                return False
        wait(started)

    def state(index=0):
        path = root/f'client-{index}.pb'
        raw = node.store(f'clients/08-cardano-probabilistic-{index}/clientState')
        with path.open('wb') as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        decoded = subprocess.check_output(['docker', 'run', '--rm', '-i', args.probe_image, 'decode', '/dev/stdin'], input=raw)
        return json.loads(decoded)

    def hermes(action, *extra, index=0, required=True, timeout=300):
        config = dict(read(root/'worker.json'), client_id=f'08-cardano-probabilistic-{index}')
        path = root/f'action-{index}.json'
        write(path, config)
        label = f'{action.removeprefix("--")}-{index}-{time.time_ns()}'
        response = subprocess.run([str(args.worker.resolve()), str(path), action, *map(str, extra)], text=True, capture_output=True, timeout=timeout)
        write_text(root/(label+'.log'), response.stdout+response.stderr)
        if required and (response.returncode or 'ChainError' in response.stdout):
            raise RuntimeError((response.stdout+response.stderr)[-8000:])
        return response

    def submit(name):
        return hermes('--submit', root/(name+'.any'))

    def capture_transactions(label):
        transactions = []
        for page in range(1, 1000):
            response = node.rpc('tx_search', {'query': 'tx.height>0', 'per_page': '100', 'page': str(page), 'order_by': 'asc'})
            transactions.extend(response.get('txs') or [])
            if len(transactions) >= int(response['total_count']):
                break
        assert len(transactions) == int(response['total_count'])
        write(root/(label+'.json'), {'total_count': len(transactions), 'txs': transactions})

    def worker(name, watch_only=False):
        path = root/(name+'.json')
        write(path, read(root/'worker.json'))
        path.with_suffix('.stop').unlink(missing_ok=True)
        path.with_suffix('.progress.json').unlink(missing_ok=True)
        process = child([str(args.worker.resolve()), str(path), *(['--watch-only'] if watch_only else [])], name)
        def ready():
            if process.poll() is not None:
                raise RuntimeError(f'{name} stopped before subscribing to production events')
            return path.with_suffix('.progress.json').exists()
        wait(ready)
        return process

    try:
        shutil.copytree(Path(__file__).parent/'evidence/network-snapshot', root/'network-snapshot', dirs_exist_ok=True)
        packet = read(root/'packet-1125-5.json')
        packet['proof_height']['revision_height'] = 1131
        write(root/'packet-1131-5.json', packet)
        helper('key', '/out/operator-key.hex')
        helper('readiness-prepare', '/out')
        history = read(root/'source-history.json')
        assert int(history['Client']['slot_length_ns']) == 10**9
        assert int(history['Client']['active_slot_coefficient_numerator']) == profile['source']['active_slot_coefficient_numerator']
        assert int(history['Client']['active_slot_coefficient_denominator']) == profile['source']['active_slot_coefficient_denominator']
        contexts = history['Honest']['Contexts']
        table = lambda rows: {row['pool_id']: int(row['stake']) for row in rows}
        distributions = {str(context['epoch']): table(context['stake_distribution']) for context in contexts}
        distributions['10'] = distributions['9']
        aggregator_input = {'epoch': int(history['Client']['current_epoch']), 'stake_distribution': table(history['Client']['epoch_stake_distribution']), 'distributions': distributions, 'release_directory': str(root), 'cache_file': str(root/'mithril-artifacts.json')}
        (root/'mithril.log').unlink(missing_ok=True)
        aggregator = child([str(args.aggregator.resolve())], 'mithril', input=json.dumps(aggregator_input).encode())
        wait(lambda: (root/'mithril.log').exists() and (root/'mithril.log').stat().st_size)
        endpoint = (root/'mithril.log').read_text().splitlines()[0]
        assert endpoint.startswith('http://127.0.0.1:'), endpoint
        env = dict(os.environ, CHECKPOINT_ACCEPTANCE_DIR=str(root), READINESS_MITHRIL_ENDPOINT=endpoint, CONSENSUS_HISTORY_CACHE_DIR=str(root/'gateway-cache'))
        gateways = []
        (root/'gateway.stop').unlink(missing_ok=True)
        source_tip = 1155 if result.get('substitute_updated') else 1124 if result.get('uncertified_epoch_9_pending') else 1093 if result.get('certified_epoch_8') else 1000 if result.get('normal_idle_checkpoint') else 997 if result.get('ordinary_activation') else 966
        write_text(root/'source-tip', str(source_tip))
        for witness in [False, True]:
            port = args.gateway_port+int(witness)
            ready = root/f'gateway-{port}.ready'
            ready.unlink(missing_ok=True)
            gateways.append(child(['node', 'node_modules/jest/bin/jest.js', 'src/query/test/query.service.stability-anchor-contract.spec.ts', '--runInBand', '-t', 'serves signed idle history'], f'gateway-{port}', dict(env, CHECKPOINT_GATEWAY_PORT=str(port), CHECKPOINT_GATEWAY_WITNESS=str(int(witness)))))
            wait(ready.exists)
        node = Node(root, args.node_image, 'testnet', args.rpc_port, scenario=args.scenario+'-imported' if result.get('export_import') else args.scenario)
        node.helper_image = args.probe_image
        if not (node.home/'config/genesis.json').exists():
            node.initialize(read(root/'bootstrap.json'))
        start_node()
        write(root/'worker.json', {
            'client_id': '08-cardano-probabilistic-0', 'key': str(root/'hermes-key.json'),
            'destination': {'type': 'CosmosSdk', 'id': 'injective-777', 'rpc_addr': f'http://127.0.0.1:{args.rpc_port}', 'grpc_addr': f'http://127.0.0.1:{args.grpc_port}', 'event_source': {'mode': 'pull', 'interval': '100ms'}, 'account_prefix': 'inj', 'key_name': 'checkpoint', 'key_store_type': 'Test', 'key_store_folder': str(root/'hermes-destination-keys'), 'store_prefix': 'ibc', 'gas_price': {'price': 500000000, 'denom': 'inj'}, 'default_gas': 1000000, 'max_gas': 75000000, 'gas_multiplier': 1.8, 'max_tx_size': 900000, 'compat_mode': '0.38', 'address_type': {'derivation': 'ethermint', 'proto_type': {'pk_type': '/injective.crypto.v1beta1.ethsecp256k1.PubKey'}}},
            'source': {'type': 'Cardano', 'id': history['Client']['chain_id'], 'gateway_url': f'http://127.0.0.1:{args.gateway_port}', 'misbehaviour_witness_gateway_url': f'http://127.0.0.1:{args.gateway_port+1}', 'network_id': 0, 'key_name': 'checkpoint', 'key_store_type': 'Test', 'key_store_folder': str(root/'hermes-source-keys'), 'bridge_manifest_path': str(Path(__file__).parent/'checkpoint-manifest.json'), 'signing_utxo_kupo_url': 'http://127.0.0.1:1', 'signing_ogmios_url': 'http://127.0.0.1:1'},
        })
        observer = worker('observer', True)
        if 'certified_bootstrap_and_interrupted_resume' not in result:
            (root/'pause-bootstrap').touch()
            interrupted = hermes('--create', required=False)
            assert interrupted.returncode and state()['bootstrap_pending']
            before = node.state()
            node.stop()
            start_node()
            assert node.state() == before
            assert observer.poll() is None, 'Production event observer stopped across node restart'
            (root/'pause-bootstrap').unlink()
            hermes('--refresh-once')
            assert not state()['bootstrap_pending']
            assert state()['trusting_period'] == '172800s'
            counters = json.loads(hermes('--counters').stdout.strip().splitlines()[-1])
            assert counters['total'] == profile['source']['extra_retained_certificate_counters']
            mark('initial_certificate_counter_rows', counters['total'])
            mark('certified_bootstrap_and_interrupted_resume', {'storage_version': state()['storage_version'], 'status': 'Active', 'restarted_node': True})
        for index in [1, 2]:
            if not node.store(f'clients/08-cardano-probabilistic-{index}/clientState'):
                hermes('--create')
        if 'bootstrap_packet' not in result:
            submit('channel-init')
            submit('channel-ack')
            submit('recv-packet-966-1')
            assert node.store('receipts/ports/transfer/channels/channel-0/sequences/1') == b'\x01'
            mark('bootstrap_packet', True)
        if 'ordinary_activation' not in result:
            write_text(root/'source-tip', '997')
            hermes('--update', 967)
            old_root = node.store('clients/08-cardano-probabilistic-0/consensusStates/0-967')
            assert old_root
            mark('previously_accepted_proof_root', {'height': 967, 'consensus_sha256': hashlib.sha256(old_root).hexdigest()})
            mark('ordinary_activation', state()['latest_height'])
        if 'normal_idle_checkpoint' not in result:
            write_text(root/'source-tip', '1000')
            maintenance = worker('maintenance')
            wait(lambda: int(state()['latest_checkpoint_height']['revision_height']) > 967, 180)
            (root/'maintenance.stop').touch()
            maintenance.wait(timeout=120)
            mark('normal_idle_checkpoint', {'checkpoint': state()['latest_checkpoint_height'], 'proof': state()['latest_height']})
        if 'certified_epoch_8' not in result:
            (root/'certificate-8').touch()
            write_text(root/'source-tip', '1093')
            hermes('--update', 1001)
            mark('certified_epoch_8', state()['latest_height'])
        if 'epoch_8_packet' not in result:
            submit('recv-packet-1001-2')
            assert node.store('receipts/ports/transfer/channels/channel-0/sequences/2') == b'\x01'
            mark('epoch_8_packet')
        if 'export_import' not in result:
            def metadata():
                return {suffix: base64.b64encode(node.store('clients/08-cardano-probabilistic-0/consensusStates/0-1001'+suffix)).decode() for suffix in ['', '/processedTime', '/processedHeight']}
            before, retained = node.state(), metadata()
            assert all(retained.values())
            capture_transactions('transactions-before-import')
            node.stop()
            exported = node.cli('export', '--output-document', '/out/native-export.json')
            write_text(root/'native-export.log', exported.stdout+exported.stderr)
            exported = read(root/'native-export.json')
            previous = node
            genesis = read(previous.home/'config/genesis.json')
            node = Node(root, args.node_image, 'testnet', args.rpc_port, scenario=args.scenario+'-imported')
            node.helper_image = args.probe_image
            assert not (node.home/'data').exists(), 'Use a fresh import directory'
            shutil.copytree(previous.home/'config', node.home/'config', dirs_exist_ok=True)
            shutil.copytree(previous.home/'keyring-test', node.home/'keyring-test', dirs_exist_ok=True)
            assert 'consensus' in exported and 'initial_height' in exported
            genesis = exported
            genesis.update(app_hash='', genesis_time=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'))
            write(node.home/'config/genesis.json', genesis)
            (node.home/'data').mkdir(exist_ok=True)
            shutil.copy2(previous.home/'data/priv_validator_state.json', node.home/'data/priv_validator_state.json')
            start_node()
            assert node.state() == before
            assert metadata() == retained
            mark('export_import', {'snapshot_format': 2, 'client_and_consensus_metadata_preserved': True})
        if 'committed_watcher_freeze' not in result:
            (root/'witness-fork').touch()
            write_text(root/'source-tip', '1124')
            existing_freeze = state().get('frozen_height')
            proposer = None if existing_freeze and int(existing_freeze['revision_height']) > 0 else child([str(args.worker.resolve()), str(root/'worker.json'), '--update', '1094'], 'proposer')
            wait(lambda: any(int(entry['epoch']) == 9 for entry in state().get('epoch_context_challenges', [])), 300)
            mark('uncertified_epoch_9_pending', state()['epoch_context_challenges'])
            # The witness constructs the alternative from signed history and
            # the destination's retained challenge context. The driver supplies
            # neither an alternative header nor a prepared misbehaviour message.
            watcher = observer
            def frozen():
                if watcher.poll() is not None:
                    raise RuntimeError('Production watcher stopped before committed freeze')
                height = state().get('frozen_height')
                return height and int(height['revision_height']) > 0
            wait(frozen, 600)
            (root/'observer.stop').touch()
            watcher.wait(timeout=120)
            if proposer:
                proposer.terminate()
                proposer.wait(timeout=30)
            (root/'witness-fork').unlink()
            status = hermes('--status')
            assert json.loads(status.stdout.strip().splitlines()[-1])['frozen']
            freeze = node.rpc('tx_search', {'query': "client_misbehaviour.client_id='08-cardano-probabilistic-0'", 'per_page': '1'})
            assert freeze['txs'] and freeze['txs'][0]['tx_result']['code'] == 0
            write(root/'freeze-block.json', node.rpc('block', {'height': freeze['txs'][0]['height']}))
            rejected = node.send(root/'recv-packet-1094-3.json', 'frozen-packet', 75000000)
            assert 'status is Frozen' in json.dumps(rejected['check_tx']) + json.dumps(rejected.get('committed'))
            assert not rejected['client_changed']
            mark('committed_watcher_freeze', {'independent_gateway_witness': True, 'hermes_status': 'Frozen', 'frozen_packet_rejected': True})
        if 'substitute_updated' not in result:
            (root/'certificate-9').touch()
            write_text(root/'source-tip', '1155')
            hermes('--update', 1125, index=2, timeout=600)
            assert int(state(2)['latest_height']['revision_height']) == 1125
            assert json.loads(hermes('--counters', index=2).stdout.strip().splitlines()[-1])['total'] > result['initial_certificate_counter_rows']
            mark('substitute_updated')
        if 'authorized_recovery' not in result:
            if 'recovery_submitted' not in result:
                subject_generation = int(state()['verification_generation'])
                unauthorized = node.send(root/'unauthorized-recovery-subject.json', 'unauthorized-recovery', 75000000)
                assert 'unauthorized' in (json.dumps(unauthorized['check_tx']) + json.dumps(unauthorized.get('committed'))).lower()
                assert not unauthorized['client_changed']
                submit('recover-subject')
                submit('vote-subject')
                mark('recovery_submitted', {'subject_generation': subject_generation})
            subject_generation = result['recovery_submitted']['subject_generation']
            def passed():
                proposal = json.loads(node.cli('query', 'gov', 'proposal', '1', '--node', 'http://127.0.0.1:26657', '--output', 'json').stdout)
                write(root/'recovery-governance.json', proposal)
                text = json.dumps(proposal)
                if 'PROPOSAL_STATUS_FAILED' in text or 'PROPOSAL_STATUS_REJECTED' in text:
                    raise RuntimeError(text)
                return 'PROPOSAL_STATUS_PASSED' in text
            wait(passed, 420)
            namespace = base64.b64decode(state()['storage_namespace'])
            def recovery_record():
                response = node.rpc('abci_query', {'path': '/store/08-cardano-probabilistic/key', 'data': (b'snapshots/v2/recovery/'+namespace).hex(), 'prove': False})
                return base64.b64decode(response['response'].get('value') or '')
            authorized = recovery_record()
            assert authorized
            (root/'recovery-authorized.cbor').write_bytes(authorized)
            submit('continue-recovery')
            continued = recovery_record()
            assert continued and continued != authorized
            (root/'recovery-continued.cbor').write_bytes(continued)
            assert int(state()['verification_generation']) == subject_generation
            before = node.state()
            node.stop()
            start_node()
            assert node.state() == before
            assert recovery_record() == continued
            for _ in range(8):
                submit('continue-recovery')
                if int(state()['verification_generation']) == subject_generation + 1:
                    break
            recovered = state()
            assert int(recovered['verification_generation']) == subject_generation + 1
            assert int(recovered['latest_height']['revision_height']) == 1125
            mark('authorized_recovery', {'generation': subject_generation + 1, 'committed_continuation_survived_restart': True, 'continuation_record_sha256': hashlib.sha256(continued).hexdigest()})
        if 'discarded_generation_rejected' not in result:
            rejected = node.send(root/'recv-packet-967-1.json', 'discarded-generation-packet', 75000000)
            failure = json.dumps(rejected['check_tx']) + json.dumps(rejected.get('committed'))
            assert 'generation' in failure.lower() or 'consensus state not found' in failure.lower(), failure
            assert not rejected['client_changed']
            mark('discarded_generation_rejected', {'previously_accepted_height': 967, 'consensus_state_missing': 'consensus state not found' in failure.lower()})
        if 'restart_packets' not in result:
            resumed_observer = worker('resumed-observer', True)
            before = node.state()
            node.stop()
            start_node()
            assert node.state() == before
            if int(state()['mithril_epoch']) < 10:
                (root/'certificate-10').touch()
                hermes('--refresh-once')
            assert int(state()['mithril_epoch']) == 10
            hermes('--update', 1131)
            assert int(state()['latest_height']['revision_height']) == 1131
            submit('recv-packet-1131-5')
            assert node.store('receipts/ports/transfer/channels/channel-0/sequences/5') == b'\x01'
            wait(lambda: read(root/'resumed-observer.progress.json').get('production_event_batches', 0) >= 3)
            (root/'resumed-observer.stop').touch()
            resumed_observer.wait(timeout=120)
            mark('restart_packets', {'certificate_ingested_after_restart': True, 'new_consensus_height': 1131, 'packet_sequence': 5})
        assert result['authorized_recovery']['committed_continuation_survived_restart']
        mark('live_rehearsal_complete')
    finally:
        for name in ['observer', 'maintenance', 'watcher', 'resumed-observer']:
            (root/(name+'.stop')).touch()
        (root/'gateway.stop').touch()
        for process in children:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
        if node and node.running:
            try:
                capture_transactions('transactions-'+node.home.name)
            finally:
                node.stop()


if __name__ == '__main__':
    main()
