#!/usr/bin/env python3
"""Restore a cold, pre-IBC rehearsal checkpoint without regenerating pool history.

Only a new disposable runtime and new Docker volumes are created. Original
signed blocks, ledger databases, genesis and deployment artifacts are copied.
This command does not start services or change the clock. Run the normal
bootstrap afterwards, which checks live deployment references and IBC inventory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_checkpoint(checkpoint, blueprint):
    metadata = json.loads((checkpoint / 'checkpoint.json').read_text())
    if metadata.get('format') != 'pr905-real-pre-ibc-checkpoint-v1':
        raise ValueError('Unsupported checkpoint format')
    files = checkpoint / 'files'
    result = json.loads((files / 'result.json').read_text())
    if result['artifacts'] != metadata['sourceRuntime'] or result['networkRuntime'] != metadata['sourceRuntime']:
        raise ValueError('Checkpoint must contain the original owned baseline')
    if sha256(files / 'runtime/genesis-shelley.json') != metadata['genesisSha256']:
        raise ValueError('Checkpoint genesis has changed')
    if sha256(files / 'plutus.json') != result['blueprintSha256']:
        raise ValueError('Checkpoint compiled deployment has changed')
    if blueprint is not None and sha256(blueprint) != result['blueprintSha256']:
        raise ValueError('Checkpoint deployment differs from the selected blueprint')
    if json.loads((files / 'clock-state.json').read_text()) != metadata['clockState']:
        raise ValueError('Checkpoint clock evidence has changed')
    if (files / 'clock-pending.json').exists() or any(files.glob('hermes*.toml')):
        raise ValueError('Checkpoint contains an unresolved clock step or initialized relayer')
    config = json.loads((files / 'compose.json').read_text())
    logical = []
    for record in metadata['volumes']:
        name = record['logical']
        if not re.fullmatch('[a-z][a-z0-9-]+', name) or record['file'] != name + '.tar.gz':
            raise ValueError('Invalid checkpoint volume archive')
        if not re.fullmatch('[0-9a-f]{64}', record['sha256']) or sha256(checkpoint / record['file']) != record['sha256']:
            raise ValueError(f'Checkpoint volume checksum differs: {name}')
        logical.append(name)
    if len(set(logical)) != len(logical) or set(logical) != set(config['volumes']):
        raise ValueError('Checkpoint volume inventory differs from compose')
    return metadata, result, config


def restore(checkpoint, runtime, project, blueprint, network_only=False):
    started = time.monotonic()
    if not runtime.is_relative_to(ROOT / '.deployment-smoke') or runtime == ROOT / '.deployment-smoke':
        raise ValueError('New owned disposable runtime required')
    if not re.fullmatch('cardano-deployment-test-[a-z0-9]+', project):
        raise ValueError('Explicit disposable project name required')
    if runtime.exists():
        raise ValueError('Refusing to overwrite any existing runtime')
    metadata, result, config = inspect_checkpoint(checkpoint, None if network_only else blueprint)
    if project == metadata['project']:
        raise ValueError('A restored project must have a different name')
    output = lambda command: subprocess.check_output(command, text=True).strip()
    run = lambda command: subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    if output(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project]):
        raise ValueError('Target project already has containers')
    existing = set(output(['docker', 'volume', 'ls', '-q']).splitlines())
    volumes = {record['logical']: project + '_' + record['logical'] for record in metadata['volumes']}
    if existing.intersection(volumes.values()):
        raise ValueError('Refusing to overwrite any existing Docker volume')
    # Reuse the exact images of the explicitly selected source project. A
    # checkpoint transported to another machine must supply these images first.
    images = dict(metadata.get('images', {}))
    for service in config['services']:
        if service in images:
            if not re.fullmatch('sha256:[0-9a-f]{64}', images[service]):
                raise ValueError('Checkpoint image must use its immutable image ID')
            run(['docker', 'image', 'inspect', images[service]])
            continue
        ids = output(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + metadata['project'],
                      '--filter', 'label=com.docker.compose.service=' + service]).splitlines()
        if len(ids) > 1:
            raise ValueError(f'Multiple source containers for {service}')
        if ids:
            images[service] = json.loads(output(['docker', 'inspect', ids[0]]))[0]['Image']
    for service, settings in config['services'].items():
        if service in images:
            continue
        # Compose may remove the successful one-shot bootstrap container.
        # Its built image still has the original project's local image tag.
        retained = subprocess.run(['docker', 'image', 'inspect', '--format', '{{.Id}}',
                                   metadata['project'] + '-' + service], capture_output=True, text=True)
        if retained.returncode != 0 or not re.fullmatch('sha256:[0-9a-f]{64}', retained.stdout.strip()):
            raise ValueError(f'No unique retained source image for {service}')
        images[service] = retained.stdout.strip()
    source = metadata['sourceRuntime']
    source_root = str(Path(source).parents[1])
    def relocate(value):
        if isinstance(value, str):
            return value.replace(source, str(runtime)).replace(source_root, str(ROOT))
        if isinstance(value, list):
            return [relocate(item) for item in value]
        if isinstance(value, dict):
            return {key: relocate(item) for key, item in value.items()}
        return value
    config = relocate(config)
    config['name'] = project
    for logical, volume in volumes.items():
        config['volumes'][logical] = {'name': volume}
    for service, image in images.items():
        config['services'][service]['image'] = image
        config['services'][service].pop('build', None)
    for logical, network in config.get('networks', {}).items():
        if network.get('external'):
            raise ValueError('External networks are unsupported in a disposable restore')
        network['name'] = project + '_' + logical
    runtime.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(checkpoint / 'files', runtime)
    (runtime / 'compose.json').write_text(json.dumps(config, indent=2) + '\n')
    result.update(project=project, networkRuntime=str(runtime), artifacts=str(runtime))
    (runtime / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    if network_only:
        (runtime / 'fresh-deployment-required.json').write_text(json.dumps({
            'checkpointBlueprintSha256': result['blueprintSha256'],
            'selectedBlueprintSha256': sha256(blueprint),
            'instruction': 'Deploy the selected contracts into a new artifact directory on this existing network. '
                           'The saved deployment must not be used as the new baseline.'}, indent=2) + '\n')
    import_map = runtime / 'import-map.json'
    if import_map.exists():
        import_map.write_text(json.dumps(relocate(json.loads(import_map.read_text())), indent=2) + '\n')
    for record in metadata['volumes']:
        volume = volumes[record['logical']]
        run(['docker', 'volume', 'create', '--label', 'com.docker.compose.project=' + project,
             '--label', 'com.docker.compose.volume=' + record['logical'], volume])
        run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'tar',
             '-v', volume + ':/data', '-v', str(checkpoint) + ':/backup:ro', images['devkit'],
             '-xzf', '/backup/' + record['file'], '-C', '/data'])
    report = {'format': 'migration-checkpoint-restore-v1', 'checkpoint': str(checkpoint),
              'checkpointSha256': sha256(checkpoint / 'checkpoint.json'), 'sourceProject': metadata['project'],
              'project': project, 'runtime': str(runtime), 'genesisSha256': metadata['genesisSha256'],
              'blueprintSha256': result['blueprintSha256'], 'images': images,
              'volumes': len(volumes), 'restoreSeconds': round(time.monotonic() - started, 3),
              'servicesStarted': False, 'requiresFreshDeployment': network_only}
    (runtime / 'checkpoint-restore.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--blueprint', type=Path, default=ROOT / 'cardano/onchain/plutus.json')
    parser.add_argument('--network-only', action='store_true', help='Reuse mature chain history for a fresh contract deployment. The saved bridge is not an acceptance baseline.')
    args = parser.parse_args()
    print(json.dumps(restore(args.checkpoint.resolve(), args.runtime.resolve(), args.project, args.blueprint.resolve(), args.network_only)))
