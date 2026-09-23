#!/usr/bin/env python3
"""Run the production migration CLI against an explicitly selected owned devnet.

Only the checked-in disposable signing key is used. This wrapper does not alter
governance delays, transaction evaluation, or the migration state machine.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--artifacts-dir', type=Path, required=True)
    parser.add_argument('--handler', type=Path)
    parser.add_argument('--executor', choices=['primary', 'secondary', 'migration'], default='primary', help='Owned public fixtures; migration is a distinct ADA-only executor with no holder assets or governance authority')
    args, command = parser.parse_known_args()
    if command and command[0] == '--':
        command = command[1:]
    runtime, artifacts = args.runtime.resolve(), args.artifacts_dir.resolve()
    handler = args.handler.resolve() if args.handler else artifacts / 'handler.json'
    for path in (runtime, artifacts, handler):
        if not path.is_relative_to(ROOT / '.deployment-smoke'):
            parser.error('Only explicit disposable migration artifacts are supported')
    if not (runtime / 'compose.json').is_file():
        parser.error('Expected an existing owned deployment-test runtime')
    genesis = json.loads((runtime / 'runtime/genesis-shelley.json').read_text())
    if genesis['networkMagic'] != 42:
        parser.error('Only the owned magic-42 devnet is supported')
    if not command or command[0] not in {
        'prepare', 'inspect', 'publish', 'authorize', 'cancel', 'rotate',
        'activate-authority', 'execute', 'resume', 'verify', 'restrict', 'propose-restoration', 'rotate-emergency', 'restore', 'cancel-restoration',
    }:
        parser.error('Supply an explicit production migration CLI command after --')
    if '--handler' in command:
        parser.error('Select the handler through the wrapper option before --')
    identity = json.loads(handler.read_text())
    if identity.get('migration', {}).get('profile') != 'cardano-ibc-compatible-v3':
        parser.error('The selected deployment has no supported migration baseline')
    public_key = re.search(r'ed25519_sk[0-9a-z]+', (ROOT / 'cardano/offchain/.env.default').read_text())
    if not public_key:
        raise RuntimeError('Checked-in disposable signing fixture is missing')
    fixture_key = public_key[0]
    if args.executor in ['secondary', 'migration']:
        # Published BIP-39 test vector, never a host/operator key. Capture only
        # into the child environment; do not print or persist key material.
        mnemonic = ('legal winner thank year wave sausage worth useful legal winner thank yellow'
                    if args.executor == 'secondary' else
                    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above')
        derive = "const {walletFromSeed}=require('@lucid-evolution/lucid');process.stdout.write(walletFromSeed(" + json.dumps(mnemonic) + ",{network:'Custom'}).paymentKey)"
        fixture_key = subprocess.check_output(['node', '-e', derive], cwd=ROOT / 'cardano/gateway', text=True).strip()
        if not fixture_key.startswith('ed25519e_sk'):
            raise RuntimeError('Unexpected disposable secondary key encoding')
    env = dict(os.environ)
    for name in ('KUPO_API_KEY', 'OGMIOS_API_KEY', 'MIGRATION_EXECUTOR_SK'):
        env.pop(name, None)
    env.update(KUPO_URL='http://127.0.0.1:2742', OGMIOS_URL='http://127.0.0.1:2637',
               CARDANO_NETWORK_MAGIC='42', MIGRATION_EXECUTOR_SK=fixture_key)
    subprocess.run([
        'deno', 'run', '--allow-net', '--allow-env', '--allow-read', '--allow-write',
        '--allow-run', '--allow-ffi', '--config', str(ROOT / 'cardano/offchain/deno.json'),
        '--import-map', str(artifacts / 'import-map.json'),
        str(ROOT / 'cardano/offchain/scripts/migrate-deployment.ts'),
        command[0], '--handler', str(handler), *command[1:],
    ], env=env, cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
