"""Use the maintained Yaci provisioner for an isolated migration rehearsal."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('migration_devkit_profile', ROOT / 'chains/cardano/devkit/profile.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)
NODES = ['devkit', *profile.PRODUCERS]


def configure_relative_clock(node, directory, offset):
    clock = directory / 'migration-clock.rc'
    if not clock.exists():
        clock.write_text(f'{offset:+d}s\n')
    node['environment']['DEVKIT_CLOCK_FILE'] = '/runtime/migration-clock.rc'


class MigrationRuntime(profile.Runtime):
    def __init__(self, root, project, offset, epoch_length, ogmios_port, kupo_port, existing=False, host_data=False):
        super().__init__(root)
        self.project = project
        self.compose_file = root / 'compose.json'
        if existing:
            if not self.compose_file.is_file() or not self.settings_path.is_file():
                raise ValueError('Expected an existing Yaci migration runtime')
            return
        if self.compose_file.exists():
            raise ValueError('Refusing to overwrite an existing migration runtime')
        reservations = []
        try:
            ports = {'DEVKIT_NODE_PORT': 23001, 'DEVKIT_OGMIOS_PORT': ogmios_port,
                     'DEVKIT_KUPO_PORT': kupo_port, 'DEVKIT_HISTORY_PORT': 29083,
                     'DEVKIT_HISTORY_DB_PORT': 27432}
            for key in profile.PORTS:
                reservation = socket.socket()
                reservation.bind(('127.0.0.1', ports.get(key, 0)))
                reservations.append(reservation)
                self.settings[key] = str(reservation.getsockname()[1])
            self.settings['DEVKIT_HOST'] = '127.0.0.1'
            profile.validate_settings(self.settings)
        finally:
            for reservation in reservations:
                reservation.close()
        profile.write_env(self.settings_path, self.settings)
        (self.state / 'clock-offset').write_text(f'{offset:+d}s')
        config = json.loads(super().compose('config', '--format', 'json', capture=True))
        runtime = root / 'runtime'
        runtime.mkdir()
        for name in NODES:
            service = config['services'][name]
            service['volumes'].append({'type': 'bind', 'source': str(runtime), 'target': '/runtime'})
            service['environment']['DEVKIT_EPOCH_LENGTH'] = str(epoch_length)
            service['environment']['DEVKIT_FULL_MESH'] = 'true'
            configure_relative_clock(service, runtime, offset)
        properties = root / 'yaci.properties'
        properties.write_text((ROOT / 'chains/cardano/yaci/config/application.properties').read_text()
                              + '\nstore.epoch-nonce.enabled=true\n')
        config['services']['history']['volumes'].append({
            'type': 'bind', 'source': str(properties), 'target': '/app/config/application.properties', 'read_only': True})
        if host_data:
            data = root / 'data'
            data.mkdir(mode=0o700)
            for name, volume in config['volumes'].items():
                directory = data / name
                directory.mkdir(mode=0o700)
                volume.update(driver='local', driver_opts={'type': 'none', 'o': 'bind', 'device': str(directory)})
            config['x-migration-host-data'] = str(data)
        profile.write_json(self.compose_file, config)

    def compose(self, *args, capture=False):
        env = {key: value for key, value in os.environ.items() if not key.startswith('COMPOSE_')}
        result = subprocess.run(['docker', 'compose', '-p', self.project, '-f', str(self.compose_file), *args],
                                env=env, text=True, capture_output=capture, check=True)
        return result.stdout.strip() if capture else None

    def export_genesis(self):
        for era in ['byron', 'shelley', 'alonzo', 'conway']:
            self.compose('cp', f'devkit:/clusters/nodes/default/node/genesis/{era}-genesis.json',
                         str(self.root / 'runtime' / f'genesis-{era}.json'))
