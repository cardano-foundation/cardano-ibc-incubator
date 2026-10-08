#!/usr/bin/env python3
"""Compare the actual Hermes funded executor on an owned, already bootstrapped devnet."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--hermes', type=Path, required=True)
    parser.add_argument('--channels', nargs='+', required=True)
    parser.add_argument('--per-channel', type=int, default=4)
    parser.add_argument('--widths', nargs='+', type=int, default=[1, 2, 4, 4, 2, 1])
    parser.add_argument('--timeout', type=int, default=1200)
    parser.add_argument('--warmup', action='store_true')
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke') or not (runtime / 'compose.json').is_file():
        parser.error('Select an explicitly owned devnet runtime in .deployment-smoke')
    genesis_bytes = (runtime / 'runtime/genesis-shelley.json').read_bytes()
    if json.loads(genesis_bytes)['networkMagic'] != 42:
        parser.error('Only disposable magic-42 networks are supported')
    if any(w <= 0 for w in args.widths) or not 1 <= args.per_channel <= 16:
        parser.error('Concurrency must be positive and each channel needs 1 to 16 requests')
    if any(not re.fullmatch('channel-[0-9]+', c) for c in args.channels):
        parser.error('Supply actual authenticated channel IDs')
    ports = json.loads((runtime / 'benchmark-ports.json').read_text())
    offset = json.loads((runtime / 'benchmark-offset.json').read_text())['offset']
    config = (runtime / 'hermes.toml').read_text()
    # Keep only the Cardano chain and its pinned manifest/key store. These runs
    # measure source packet execution, not counterparty relay or pruning.
    parts = config.split('[[chains]]')
    cardano = next(p for p in parts[1:] if "type = 'Cardano'" in p)
    prefix = parts[0]
    prefix = re.sub(r'(\[mode\.[^]]+\]\s*\n(?:#[^\n]*\n)*enabled = )true', r'\1false', prefix)
    cardano = re.sub(r'^packet_executor_concurrency = .+\n', '', cardano, flags=re.M)
    template = prefix + '[[chains]]' + cardano.replace("type = 'Cardano'", "type = 'Cardano'\npacket_executor_concurrency = __WIDTH__")
    env = dict(os.environ, FAKETIME_DONT_FAKE_MONOTONIC='1', NO_COLOR='1')
    identifier = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = runtime / ('benchmark-' + identifier)
    directory.mkdir()
    deno = ['deno', 'run', '--config', str(ROOT / 'cardano/offchain/deno.json'),
            '--allow-net', '--allow-env', '--allow-read', '--allow-run', '--allow-ffi', '--allow-write',
            str(ROOT / 'scripts/benchmark/prepare-packet-executor-backlog.ts'), str(runtime)]
    runs = []
    widths = [2] if args.warmup else args.widths
    for index, width in enumerate(widths):
        label = f'{index}-width-{width}'
        receipt_path = directory / (label + '-backlog.json')
        with (directory / (label + '-admission.log')).open('w') as log:
            subprocess.run(deno + [','.join(args.channels), str(args.per_channel), str(receipt_path)],
                           cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
        receipt = json.loads(receipt_path.read_text())
        selected = directory / (label + '.toml')
        selected.write_text(template.replace('__WIDTH__', str(width)))
        selected.chmod(0o600)
        log_path = directory / (label + '-hermes.log')
        with log_path.open('w') as log:
            start = time.monotonic()
            process = subprocess.Popen(['faketime', '-f', f'{offset:+d}s', str(args.hermes.resolve()),
                '--config', str(selected), 'start'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                env=env, start_new_session=True)
            try:
                deadline = start + args.timeout
                while True:
                    text = re.sub(r'\x1b\[[0-9;]*m', '', log_path.read_text())
                    included = [line for line in text.splitlines() if 'Funded request batch included' in line]
                    sends = [line for line in included if 'stage=send' in line]
                    packets = sum(int(re.search(r'intents=(\d+)', line)[1]) for line in sends)
                    if packets == receipt['packets']:
                        elapsed = time.monotonic() - start
                        break
                    if packets > receipt['packets']:
                        raise RuntimeError('Executor processed an unexpected backlog. Retain evidence and reconcile')
                    if process.poll() is not None:
                        raise RuntimeError(f'Hermes exited early. Inspect {log_path}')
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f'Backlog did not drain before timeout. Inspect {log_path}')
                    time.sleep(0.5)
                transactions = []
                for line in sends:
                    transactions.append({
                        'hash': re.search(r'tx_hash=([0-9a-f]{64})', line)[1],
                        'channel': re.search(r'channel=(channel-[0-9]+)', line)[1],
                        'height': re.search(r'height=([^ ]+)', line)[1],
                        'intents': int(re.search(r'intents=(\d+)', line)[1]),
                        'log': line,
                    })
                if len({tx['hash'] for tx in transactions}) != len(transactions):
                    raise RuntimeError('Duplicate inclusion receipt')
                # Outside the timer, authenticate canonical block bytes and
                # check that the exact funded outputs are transaction inputs.
                consumption = {}
                for tx in sorted(transactions, key=lambda t: int(t['height'].split('-')[-1]), reverse=True):
                    canonical_path = directory / (tx['hash'] + '-canonical.json')
                    with (directory / (tx['hash'] + '-verification.log')).open('w') as verification:
                        subprocess.run(['node', str(ROOT / 'scripts/ci/aiken-contract-migration/measure-migration-transaction.cjs'),
                                        str(runtime), tx['hash'], str(canonical_path), '24'], cwd=ROOT,
                                       stdout=verification, stderr=subprocess.STDOUT, env=env, check=True)
                    canonical = json.loads(canonical_path.read_text())
                    tx['canonicalReport'] = str(canonical_path)
                    for spent in canonical['inputs']:
                        ref = (spent['txHash'], spent['outputIndex'])
                        consumption[ref] = consumption.get(ref, 0) + 1
                for intent in receipt['intents']:
                    if consumption.get((intent['txHash'], intent['outputIndex'])) != 1:
                        raise RuntimeError('A funded intent has no unique authenticated canonical spend')
                # Check canonical Kupo consumption for every admitted output.
                for intent in receipt['intents']:
                    url = f"http://127.0.0.1:{ports['DEVKIT_KUPO_PORT']}/matches/{intent['outputIndex']}@{intent['txHash']}?unspent"
                    with urllib.request.urlopen(url, timeout=30) as response:
                        if json.load(response):
                            raise RuntimeError('An admitted intent remains unspent after recorded inclusion')
                result = {
                    'concurrency': width, 'secondsFromHermesStart': elapsed,
                    'packets': packets, 'packetsPerSecond': packets / elapsed,
                    'transactions': transactions,
                    'initializations': len(included) - len(sends),
                    'retries': text.count('Funded request batch will retry'),
                    'backlogReceipt': str(receipt_path), 'hermesLog': str(log_path),
                    'canonicalIntentConsumptionChecked': True,
                    'canonicalBlockBodiesAuthenticated': True,
                    'confirmationDepthCheckedOutsideTimer': 24,
                }
                runs.append(result)
                (directory / (label + '-result.json')).write_text(json.dumps(result, indent=2) + '\n')
                print(json.dumps({k: v for k, v in result.items() if k not in ['transactions']}), flush=True)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=15)
    report = {
        'scope': 'Actual Hermes binary with production Gateway signing policy, trusted Ogmios evaluation/submission and real node inclusion. Source packet execution only. Admission and channel setup are outside the timer. No acknowledgements, pruning or rollback exercise.',
        'warmup': args.warmup, 'channels': args.channels, 'perChannel': args.per_channel,
        'genesisSha256': hashlib.sha256(genesis_bytes).hexdigest(),
        'hermesBinarySha256': hashlib.sha256(args.hermes.read_bytes()).hexdigest(),
        'incubatorCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'devnetVm': json.loads((runtime / 'benchmark-vm.json').read_text()) if (runtime / 'benchmark-vm.json').exists() else None,
        'runs': runs,
    }
    (directory / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'report': str(directory / 'report.json')}), flush=True)


if __name__ == '__main__':
    main()
