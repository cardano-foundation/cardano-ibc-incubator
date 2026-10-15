#!/usr/bin/env python3
"""Summarize captured native application transactions without copying test keys."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('runs', nargs='+', type=Path)
args = parser.parse_args()
report = {'source_tag': 'v1.18.0-1770939123', 'source_commit': '6632cef271f7482f39f9c5d4b085adc1370e8b7e',
          'host_execution': 'native InjectiveApp in a separate socket ABCI process',
          'controlled_clock': True, 'transaction_gas_limit': 75000000, 'block_gas_limit': 150000000,
          'block_max_bytes': 4194304, 'relayer_max_tx_bytes': 1000000, 'gas_multiplier': 1.8,
          'synthetic_source_trusting_period_days': 7, 'runs': []}
for root in args.runs:
    transactions = json.loads((root / 'bounded-transactions.json').read_text())
    completed = [row for row in transactions if 'execution' in row and int(row['execution']['code']) == 0]
    if not completed:
        raise RuntimeError(f'{root} has no committed transactions')
    result = json.loads((root / 'bounded-result.json').read_text())
    if not result['accepted_proposal'] or not result['freeze_before_deadline']:
        raise RuntimeError(f'{root} did not accept and freeze its proposal')
    summary = {'name': root.name, 'result': result, 'committed_transactions': len(completed),
               'max_signed_bytes': max(row['signed_bytes'] for row in completed),
               'max_simulation_gas': max(row.get('simulation_gas', 0) for row in completed),
               'max_execution_gas': max(int(row['execution']['gas_used']) for row in completed),
               'max_requested_gas': max(row.get('gas_wanted', 0) for row in completed),
               'expected_rejections': [row['label'] for row in transactions if 'expected_rejection' in row]}
    for name in ['bounded-lifecycle-result.json', 'bounded-restart-result.json']:
        if (root / name).exists():
            summary[name.removesuffix('.json')] = json.loads((root / name).read_text())
    summary['steps'] = [{key: row[key] for key in ['label', 'signed_bytes', 'simulation_gas', 'gas_wanted'] if key in row}
                        | {'execution_gas': int(row['execution']['gas_used'])} for row in completed]
    report['runs'].append(summary)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
