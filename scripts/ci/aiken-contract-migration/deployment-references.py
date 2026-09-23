#!/usr/bin/env python3
"""Check saved reference outrefs against both Kupo and the node's live ledger."""
import argparse
import json
from pathlib import Path
import subprocess
import urllib.request


def manifest_references(handler, plan):
    scripts = {(v['script']['type'], script_payload(v['script']['script'])): v['hash'] for v in plan['referenceValidators']}
    references = {}
    def visit(value):
        if isinstance(value, dict):
            if 'refUtxo' in value:
                reference_script = value['refUtxo']['scriptRef']
                payload = script_payload(reference_script['script'])
                actual_hash = scripts.get((reference_script['type'], payload))
                if value.get('scriptHash') != actual_hash or not isinstance(value.get('script'), str) or script_payload(value['script']) != payload:
                    raise ValueError('Validator role does not match its reference script')
            if 'registryReference' in value:
                registry = next((v for v in plan['referenceValidators'] if v['title'] == 'implementation_registry.implementation_registry.spend'), None)
                if not registry or value.get('registryAddress') != registry['address'] or script_payload(value['registryReference']['scriptRef']['script']) != script_payload(registry['script']['script']):
                    raise ValueError('Registry role does not match its reference script')
            if 'txHash' in value and 'outputIndex' in value and 'scriptRef' in value:
                script_hash = scripts.get((value['scriptRef']['type'], script_payload(value['scriptRef']['script'])))
                if not script_hash:
                    raise ValueError('Manifest reference script is absent from the deployment plan')
                key = f"{value['txHash']}#{value['outputIndex']}"
                entry = {**value, 'scriptHash': script_hash}
                if key in references and references[key] != entry:
                    raise ValueError('Conflicting manifest reference outref')
                references[key] = entry
            else:
                for child in value.values(): visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
    visit(handler)
    if {v['scriptHash'] for v in references.values()} != set(scripts.values()):
        raise ValueError('Manifest omits planned reference scripts')
    return references


def unwrap_bytes(encoded):
    raw = bytes.fromhex(encoded)
    if not raw or raw[0] >> 5 != 2:
        raise ValueError('Expected definite CBOR script bytes')
    info = raw[0] & 31
    size = 0 if info < 24 else {24: 1, 25: 2, 26: 4, 27: 8}.get(info)
    if size is None: raise ValueError('Indefinite CBOR script bytes unsupported')
    length = info if size == 0 else int.from_bytes(raw[1:1+size], 'big')
    if len(raw) != 1 + size + length: raise ValueError('Invalid CBOR script byte length')
    return raw[1+size:].hex()


def script_payload(encoded):
    # Lucid's manifests use a double byte-string wrapper; the CLI and plan use
    # one. Compare the actual Flat program, accepting only those two encodings.
    payload = unwrap_bytes(encoded)
    if bytes.fromhex(payload)[0] >> 5 == 2:
        payload = unwrap_bytes(payload)
    return payload


def verify_references(expected, indexed, ledger):
    for key, wanted in expected.items():
        matches = [u for u in indexed if f"{u['transaction_id']}#{u['output_index']}" == key]
        if len(matches) != 1:
            raise ValueError(f'Reference {key} has no unique unspent Kupo match')
        found = matches[0]
        if found['address'] != wanted['address'] or found.get('script_hash') != wanted['scriptHash'] or found.get('spent_at') is not None:
            raise ValueError(f'Reference {key} Kupo address/script/custody mismatch')
        actual = ledger.get(key)
        if not actual or actual['address'] != wanted['address']:
            raise ValueError(f'Reference {key} is absent at its expected ledger address')
        script = (actual.get('referenceScript') or {}).get('script') or {}
        if script.get('type') != wanted['scriptRef']['type'].replace('PlutusV', 'PlutusScriptV') or not script.get('cborHex') or script_payload(script['cborHex']) != script_payload(wanted['scriptRef']['script']):
            raise ValueError(f'Reference {key} ledger script bytes mismatch')


def inspect_references(handler, plan, compose, kupo, output):
    expected = manifest_references(handler, plan)
    report = {'expected': {k: {'address': v['address'], 'scriptHash': v['scriptHash']} for k, v in expected.items()}}
    def cli(*args):
        return json.loads(subprocess.check_output(compose + ['exec', '-T', 'node', 'cardano-cli', 'conway', 'query', *args, '--testnet-magic', '42'], timeout=45))
    try:
        report['tipBefore'] = cli('tip')
        indexed = []
        for address in sorted({v['address'] for v in expected.values()}):
            with urllib.request.urlopen(kupo + '/matches/' + address + '?unspent', timeout=20) as response:
                indexed.extend(json.load(response))
        report['indexed'] = indexed
        args = [x for key in expected for x in ['--tx-in', key]]
        ledger = cli('utxo', *args, '--out-file', '/dev/stdout')
        report['ledger'] = {k: {'address': v['address'], 'hasReferenceScript': bool(v.get('referenceScript'))} for k, v in ledger.items()}
        report['tipAfter'] = cli('tip')
        verify_references(expected, indexed, ledger)
        report['verified'] = True
        return report
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        Path(output).write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3] / '.deployment-smoke'
    runtime, artifacts, output = args.runtime.resolve(), args.artifacts.resolve(), args.output.resolve()
    if any(not p.is_relative_to(root) for p in [runtime, artifacts, output]) or output.exists():
        parser.error('Owned runtime/artifacts and a new evidence path required')
    result = json.loads((artifacts / 'result.json').read_text())
    if result['networkRuntime'] != str(runtime) or not result['project'].startswith('cardano-deployment-test-'):
        parser.error('Runtime provenance mismatch')
    compose = ['docker', 'compose', '-p', result['project'], '-f', str(runtime / 'compose.json')]
    port = subprocess.check_output(compose + ['port', 'kupo', '1442'], text=True).strip()
    if not port.startswith('127.0.0.1:'): parser.error('Owned loopback Kupo required')
    inspect_references(json.loads((artifacts / 'handler.json').read_text()), json.loads((artifacts / 'deployment-plan.json').read_text()), compose, 'http://' + port, output)
