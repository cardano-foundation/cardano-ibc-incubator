#!/usr/bin/env python3
"""Run isolated history/Gateway/Cosmos services for a migration rehearsal.

Requires the fresh five-pool output of test-cardano-migration-deployment.py and the explicit
test-only Cosmos clock image. Never connects to a live bridge or uses host keys.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def require_migration_witness(node):
    ports = node.get('ports', [])
    if not any(isinstance(port, dict) and port.get('host_ip') == '127.0.0.1'
               and int(port.get('published', 0)) == 23001 and int(port.get('target', 0)) == 3001
               for port in ports):
        raise ValueError('Node witness port 23001 must be configured before deployment')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['services', 'init-history', 'gateway', 'history-sync', 'export', 'witness'])
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--project', required=True)
    p.add_argument('--clock-offset-seconds', type=int, required=True)
    p.add_argument('--handler', type=Path)
    p.add_argument('--out', type=Path, help='New activation witness file; only valid with witness')
    p.add_argument('--gateway-database', default='migration_gateway')
    p.add_argument('--history-schema', help='Existing private bridge-projection schema sharing the canonical Yaci source tables')
    args = p.parse_args()
    import re
    if not re.fullmatch(r'migration_[a-z0-9_]+', args.gateway_database):
        p.error('Rehearsal gateway database must begin migration_ and use lowercase letters, digits or underscores')
    if args.history_schema and not re.fullmatch(r'migration_[a-z0-9_]+', args.history_schema):
        p.error('Private history schema must begin migration_ and use lowercase letters, digits or underscores')
    runtime = args.runtime.resolve()
    if not args.project.startswith('cardano-deployment-test-') or not runtime.is_relative_to(ROOT / '.deployment-smoke'):
        p.error('Only an explicitly selected disposable deployment-test runtime is supported')
    if not -63072000 <= args.clock_offset_seconds <= 0:
        p.error('Rehearsal clocks must remain within the previous two years')
    if (args.command == 'witness') != (args.out is not None):
        p.error('witness requires --out; other commands do not accept it')
    if args.out and (not args.out.resolve().is_relative_to(ROOT / '.deployment-smoke') or args.out.exists()):
        p.error('The witness must be a new file inside the disposable artifact directory')
    compose_file = runtime / 'compose.json'
    config = json.loads(compose_file.read_text())
    if len([name for name in config['services'] if name == 'devkit' or name.startswith('producer-')]) != 5:
        p.error('Counterparty rehearsal requires the actual five-pool network')
    compose = ['docker', 'compose', '-p', args.project, '-f', str(compose_file)]
    if args.command == 'services':
        require_migration_witness(config['services']['devkit'])
        base = json.loads(subprocess.check_output(['docker', 'compose', '-f', str(ROOT / 'chains/cosmos/docker-compose.yml'), '--profile', 'v8-classic', 'config', '--format', 'json']))['services']['v8-classic']
        env = base['environment']
        env.update({'COSMOS_GENESIS_TIME': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=args.clock_offset_seconds - 30)).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'COSMOS_CHAIN_ID': 'migration-462-1', 'COSMOS_MONIKER': 'migration-rehearsal',
            'MIGRATION_REHEARSAL_CLOCK_OFFSET_SECONDS': str(args.clock_offset_seconds),
            'COSMOS_GOV_VOTING_PERIOD': '172800s'})
        # Reusing a home must retain its actual genesis; a changed clock only
        # affects future block production, never rewrites committed state.
        if 'cosmos' in config['services']:
            env['COSMOS_GENESIS_TIME'] = config['services']['cosmos']['environment']['COSMOS_GENESIS_TIME']
        config['services']['cosmos'] = {'image': 'cardano-ibc-migration-cosmos-clock', 'environment': env,
            'volumes': ['cosmos-data:/var/lib/simd'], 'ports': ['127.0.0.1:28757:26657', '127.0.0.1:1527:1317', '127.0.0.1:9300:9090'], 'healthcheck': base['healthcheck']}
        config['volumes'].setdefault('cosmos-data', {})
        if config.get('x-migration-host-data'):
            data_root = Path(config['x-migration-host-data']).resolve()
            if data_root != runtime / 'data':
                p.error('Host data must remain inside this explicit disposable runtime')
            directory = data_root / 'cosmos-data'
            directory.mkdir(mode=0o700, exist_ok=True)
            config['volumes']['cosmos-data'] = {'driver': 'local', 'driver_opts': {
                'type': 'none', 'o': 'bind', 'device': str(directory)}}
        compose_file.write_text(json.dumps(config, indent=2) + '\n')
        for database in ['yaci_store', 'migration_gateway']:
            exists = subprocess.check_output(compose + ['exec', '-T', 'history-db', 'psql', '-U', 'yaci', '-d', 'postgres', '-Atc', f"SELECT 1 FROM pg_database WHERE datname='{database}'"], text=True).strip()
            if not exists: subprocess.run(compose + ['exec', '-T', 'history-db', 'createdb', '-U', 'yaci', database], check=True)
        subprocess.run(compose + ['up', '-d', 'cosmos'], check=True)
        return
    handler = args.handler.resolve() if args.handler else runtime / 'handler.json'
    if not handler.is_file(): raise RuntimeError('Wait for the genuine baseline deployment manifest')
    if args.command == 'init-history':
        if not args.history_schema:
            p.error('init-history requires an explicit private --history-schema')
        # A fresh bridge gets separate projections of the same canonical source
        # transactions. Restrict search_path during DDL: including public here
        # would make IF NOT EXISTS silently reuse another bridge\'s tables.
        exists = subprocess.check_output(compose + ['exec', '-T', 'history-db', 'psql', '-U', 'yaci', '-d', 'postgres', '-Atc',
            f"SELECT 1 FROM pg_database WHERE datname='{args.gateway_database}'"], text=True).strip()
        if not exists:
            subprocess.run(compose + ['exec', '-T', 'history-db', 'createdb', '-U', 'yaci', args.gateway_database], check=True)
        initialization = r'''
const fs = require('fs');
const { Client } = require('pg');
const { ensureBridgeHistoryTables } = require('./dist/scripts/yaci-bridge-history-sync.js');
(async () => {
  const [schema, handlerPath] = process.argv.slice(2);
  if (!/^migration_[a-z0-9_]+$/.test(schema)) throw new Error('Invalid private schema');
  const handler = JSON.parse(fs.readFileSync(handlerPath, 'utf8'));
  const identity = handler.hostStateNFT.policyId + handler.hostStateNFT.name;
  if (!/^[0-9a-f]+$/.test(identity) || !handler.migration?.registryUnit) throw new Error('Expected upgrade-capable baseline');
  const db = new Client({ host: '127.0.0.1', port: 27432, database: 'yaci_store', user: 'yaci', password: 'devkit' });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}`);
    await db.query('CREATE TABLE IF NOT EXISTS rehearsal_bridge_identity (singleton boolean PRIMARY KEY CHECK (singleton), host_state_unit text NOT NULL, registry_unit text NOT NULL)');
    await db.query('INSERT INTO rehearsal_bridge_identity VALUES (true, $1, $2) ON CONFLICT DO NOTHING', [identity, handler.migration.registryUnit]);
    const { rows } = await db.query('SELECT host_state_unit, registry_unit FROM rehearsal_bridge_identity');
    if (rows.length !== 1 || rows[0].host_state_unit !== identity || rows[0].registry_unit !== handler.migration.registryUnit) {
      throw new Error('Projection schema belongs to another bridge; select a fresh private schema');
    }
    await ensureBridgeHistoryTables(db);
    await db.query('COMMIT');
    console.log(JSON.stringify({ schema, hostStateUnit: identity, initialized: true }));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'''
        subprocess.run(['node', '-', args.history_schema, str(handler)], input=initialization,
            text=True, cwd=ROOT / 'cardano/gateway', check=True)
        return
    genesis = json.loads((runtime / 'runtime/genesis-shelley.json').read_text())
    env = dict(os.environ)
    # Explicit local values; never load operator .env or Hermes home keys.
    for key in ['KUPO_API_KEY', 'OGMIOS_API_KEY', 'HISTORY_DB_URL', 'CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE', 'CARDANO_EPOCH_PARAMS_ENDPOINT', 'CARDANO_STABILITY_ASSUME_STATIC_STAKE', 'CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT', 'BRIDGE_MANIFEST_PATH']:
        env.pop(key, None)
    env.update({'PORT': '8800', 'GRPC_HOST': '127.0.0.1', 'GRPC_PORT': '5501', 'CARDANO_NETWORK_MAGIC': '42',
        'CARDANO_CHAIN_HOST': '127.0.0.1', 'CARDANO_CHAIN_PORT': '23001',
        'CARDANO_CHAIN_NETWORK_MAGIC': '42', 'CARDANO_CHAIN_ID': 'cardano-devnet', 'CARDANO_LIGHT_CLIENT_MODE': 'stake-weighted-stability',
        'CARDANO_EPOCH_LENGTH': str(genesis['epochLength']), 'CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS': '604800',
        'CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS': '10',
        'CARDANO_LOCAL_EPOCH_SNAPSHOT_DIR': str(runtime / 'epoch-stake'),
        'CARDANO_EPOCH_NONCE_GENESIS': hashlib.blake2b((runtime / 'runtime/genesis-shelley.json').read_bytes(), digest_size=32).hexdigest(),
        'OGMIOS_ENDPOINT': 'http://127.0.0.1:2637', 'KUPO_ENDPOINT': 'http://127.0.0.1:2742', 'YACI_STORE_ENDPOINT': 'http://127.0.0.1:29083',
        'HISTORY_DB_HOST': '127.0.0.1', 'HISTORY_DB_PORT': '27432', 'HISTORY_DB_NAME': 'yaci_store', 'HISTORY_DB_USERNAME': 'yaci', 'HISTORY_DB_PASSWORD': 'devkit',
        'GATEWAY_DB_HOST': '127.0.0.1', 'GATEWAY_DB_PORT': '27432', 'GATEWAY_DB_NAME': args.gateway_database, 'GATEWAY_DB_USERNAME': 'yaci', 'GATEWAY_DB_PASSWORD': 'devkit', 'GATEWAY_DB_SYNCHRONIZE': 'true',
        'HANDLER_JSON_PATH': str(handler), 'CONSENSUS_HISTORY_CACHE_DIR': str(handler.parent / 'consensus-history'),
        'FAKETIME_DONT_FAKE_MONOTONIC': '1'})
    if args.command == 'gateway':
        # This explicitly owned public-fixture rehearsal retains bounded unsigned
        # transaction diagnostics, including a rejected budget probe.
        env['GATEWAY_DEBUG_DIAGNOSTICS'] = 'true'
        env['GATEWAY_DEBUG_DIAGNOSTICS_DIR'] = str(runtime / 'gateway-diagnostics')
    if args.history_schema:
        env['PGOPTIONS'] = f'-c search_path={args.history_schema},public'
    else:
        env.pop('PGOPTIONS', None)
    script = {'gateway': 'dist/main.js', 'history-sync': 'dist/scripts/yaci-bridge-history-sync.js', 'export': 'dist/scripts/export-bridge-manifest.js', 'witness': 'dist/scripts/export-migration-witness.js'}[args.command]
    command = ['faketime', '-f', f'{args.clock_offset_seconds:+d}s', 'node', script]
    if args.command == 'export': command += [str(handler), str(handler.parent / f'bridge-manifest-{json.loads(handler.read_text())["migration"]["generation"]}.json')]
    if args.command == 'witness': command += [str(handler), str(args.out.resolve())]
    subprocess.run(command, env=env, cwd=ROOT / 'cardano/gateway', check=True)

if __name__ == '__main__': main()
