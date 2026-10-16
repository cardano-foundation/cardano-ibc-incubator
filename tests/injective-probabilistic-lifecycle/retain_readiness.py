#!/usr/bin/env python3
"""Keep a successful rehearsal's public evidence with hashes and provenance."""
import argparse
import base64
from collections import Counter
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

from harness import read, write


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def unix_ns(value):
    seconds, _, fraction = value.removesuffix('Z').partition('.')
    return int(datetime.datetime.fromisoformat(seconds).replace(tzinfo=datetime.timezone.utc).timestamp())*10**9 + int((fraction+'0'*9)[:9])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run', type=Path)
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--native-binary', type=Path, required=True)
    parser.add_argument('--worker', type=Path, required=True)
    args = parser.parse_args()
    root = args.run.resolve()
    repo = Path(__file__).resolve().parents[2]
    result = read(root/'readiness-result.json')
    assert result['live_rehearsal_complete']
    assert result['authorized_recovery']['committed_continuation_survived_restart']
    assert result['previously_accepted_proof_root']['height'] == 967
    assert result['production_gate_closed'] is False
    continued = (root/'recovery-continued.cbor').read_bytes()
    assert sha256(continued) == result['authorized_recovery']['continuation_record_sha256']
    assert continued != (root/'recovery-authorized.cbor').read_bytes()
    decode_progress = """
const {Cbor}=require('@harmoniclabs/cbor')
const fs=require('fs')
const get=(value,key)=>value.map.find(entry=>entry.k.text===key).v
const value=Cbor.parse(fs.readFileSync(process.argv[1]))
console.log(JSON.stringify({checked:Number(get(value,'Checked').num),rows:Number(get(get(get(value,'Subject'),'Counters'),'Rows').num)}))
"""
    recovery_progress = json.loads(subprocess.check_output(['node', '-e', decode_progress, str(root/'recovery-continued.cbor')], cwd=repo/'cardano/gateway', text=True))
    assert 0 < recovery_progress['checked'] < recovery_progress['rows']
    freeze_time = unix_ns(read(root/'freeze-block.json')['block']['header']['time'])
    deadline = next(int(entry['usable_after_unix_ns']) for entry in result['uncertified_epoch_9_pending'] if int(entry['epoch']) == 9)
    assert freeze_time < deadline
    before = read(root/'transactions-before-import.json')
    after_path = next(root.glob('transactions-*-imported.json'))
    after = read(after_path)
    transactions = before['txs'] + after['txs']
    assert len(transactions) == int(before['total_count']) + int(after['total_count'])
    assert len({tx['hash'] for tx in transactions}) == len(transactions)
    unexpected = [tx for tx in transactions if tx['tx_result']['code'] and 'unauthorized' not in tx['tx_result'].get('log', '')]
    assert not unexpected, unexpected
    events = Counter(event['type'] for tx in transactions for event in tx['tx_result']['events'])
    assert events['client_misbehaviour'] == 1
    assert events['recv_packet'] >= 3
    assert events['probabilistic_recovery_activated'] == 1
    assert read(root/'recovery-governance.json')['proposal']['status'] == 'PROPOSAL_STATUS_PASSED'
    for log in root.glob('*.log'):
        assert 'failed to extract IBC events' not in log.read_text(), log
    args.evidence.mkdir(parents=True, exist_ok=False)
    files = [root/'source-history.json', root/'gateway-history.json', root/'source-input.json', root/'native-export.json', root/'bootstrap-requests.jsonl', root/'recovery-governance.json', root/'readiness-profile.json', root/'client-0.pb', root/'observer.events.jsonl', root/'resumed-observer.events.jsonl', root/'transactions-before-import.json', root/'freeze-block.json', root/'recovery-authorized.cbor', root/'recovery-continued.cbor', after_path]
    files.extend(root.glob('gateway-*.jsonl'))
    files.extend(root.glob('*.log'))
    files.extend(root.glob('testnet-*/node.log'))
    files.extend(root.glob('testnet-*/transactions.json'))
    manifest = {}
    for source in files:
        raw = source.read_bytes()
        relative = source.relative_to(root)
        target = args.evidence/'artifacts'/relative.with_name(relative.name+'.gz')
        target.parent.mkdir(parents=True, exist_ok=True)
        compressed = gzip.compress(raw, mtime=0)
        target.write_bytes(compressed)
        manifest[str(relative)] = {'bytes': len(raw), 'sha256': sha256(raw), 'gzip_sha256': sha256(compressed)}
    build_info = subprocess.check_output(['go', 'version', '-m', str(args.native_binary)], text=True)
    (args.evidence/'native-build-info.txt').write_text('\n'.join(line.rstrip() for line in build_info.splitlines())+'\n')
    report = {
        'result': result,
        'candidate': {
            'injective_commit': read(root/'readiness-profile.json')['injective_commit'],
            'module_parent_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
            'hermes_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo/'relayer', text=True).strip(),
            'injectived_sha256': sha256(args.native_binary.read_bytes()),
            'checkpoint_worker_sha256': sha256(args.worker.read_bytes()),
        },
        'measurements': {
            'committed_transactions': len(transactions),
            'successful_transactions': sum(tx['tx_result']['code'] == 0 for tx in transactions),
            'largest_signed_transaction_bytes': max(len(base64.b64decode(tx['tx'])) for tx in transactions),
            'peak_execution_gas': max(int(tx['tx_result']['gas_used']) for tx in transactions),
            'peak_requested_gas': max(int(tx['tx_result']['gas_wanted']) for tx in transactions),
            'peak_successful_requested_gas': max(int(tx['tx_result']['gas_wanted']) for tx in transactions if tx['tx_result']['code'] == 0),
            'freeze_deadline_remaining_seconds': (deadline-freeze_time)/10**9,
            'recovery_counters_checked_before_restart': recovery_progress['checked'],
            'recovery_counter_rows': recovery_progress['rows'],
            'keeper_events': dict(sorted(events.items())),
        },
        'artifacts': manifest,
    }
    write(args.evidence/'results.json', report)
    print(json.dumps(report['measurements'], indent=2))


if __name__ == '__main__':
    main()
