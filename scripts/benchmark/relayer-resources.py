#!/usr/bin/env python3
"""Read-only resource samples for explicitly selected containers and host processes."""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import time


def command(*args):
    return subprocess.check_output(args, text=True, timeout=30).strip()


def size(text):
    match = re.fullmatch(r'([0-9.]+)\s*([kKMGTPE]?i?B)', text.strip())
    if not match:
        raise ValueError(f'Unrecognized Docker size: {text}')
    units = {'B': 1, 'kB': 1000}
    for exponent, prefix in enumerate('KMGTPE', 1):
        units[prefix + 'B'] = 1000 ** exponent
        units[prefix + 'iB'] = 1024 ** exponent
    return round(float(match[1]) * units[match[2]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', action='append', required=True)
    parser.add_argument('--pid', action='append', type=int, default=[])
    parser.add_argument('--phase', choices=['idle', 'warmup', 'traffic', 'drain', 'fault'], required=True)
    parser.add_argument('--duration', type=float, default=3600)
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not math.isfinite(args.duration) or not math.isfinite(args.interval) or args.duration <= 0 or args.interval < 1 or any(pid <= 0 for pid in args.pid) or not all(re.fullmatch(r'[a-zA-Z0-9_-]+', p) for p in args.project):
        parser.error('Use positive duration, interval >= 1 and explicit Compose project names')
    ids = set()
    for project in args.project:
        selected = command('docker', 'ps', '-q', '--filter', f'label=com.docker.compose.project={project}').splitlines()
        if not selected:
            parser.error(f'No running containers for project {project}')
        ids.update(selected)
    containers = json.loads(command('docker', 'inspect', *sorted(ids)))
    runtime = json.loads(command('docker', 'info', '--format', '{{json .}}'))
    metadata = {
        'kind': 'metadata', 'phase': args.phase, 'projects': args.project,
        'collectorCommit': command('git', '-C', str(Path(__file__).resolve().parents[2]), 'rev-parse', 'HEAD'),
        'collectorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'host': {'system': platform.system(), 'machine': platform.machine(), 'logicalCpus': os.cpu_count()},
        'docker': {k: runtime.get(k) for k in ['ServerVersion', 'NCPU', 'MemTotal', 'Driver', 'Architecture']},
        'intervalSeconds': args.interval, 'requestedDurationSeconds': args.duration,
        'containers': [{
            'id': c['Id'], 'name': c['Name'], 'image': c['Image'],
            'startedAt': c['State']['StartedAt'], 'restartCount': c['RestartCount'],
            'memoryLimitBytes': c['HostConfig']['Memory'], 'nanoCpuLimit': c['HostConfig']['NanoCpus'],
        } for c in containers],
        'hostPids': args.pid,
        'scope': 'Observed resources only. A short idle sample cannot establish throughput, long-term growth or production hosting capacity. Database sizes and chain retention need separate measurements.',
    }
    with args.output.open('x') as output:
        def emit(value):
            output.write(json.dumps(value) + '\n')
            output.flush()
        emit(metadata)
        start = time.monotonic()
        wall_start = time.time()
        count = 0
        while True:
            elapsed = time.monotonic() - start
            if abs((time.time() - wall_start) - elapsed) > max(5, elapsed * 0.02):
                raise RuntimeError('Host suspension or clock change invalidated this resource window')
            snapshots = [json.loads(line) for line in command('docker', 'stats', '--no-stream', '--format', '{{json .}}', *sorted(ids)).splitlines()]
            if len(snapshots) != len(ids):
                raise RuntimeError('A selected component disappeared. Retain the incomplete window')
            for row in snapshots:
                row['memoryBytes'] = size(row['MemUsage'].split('/')[0])
                row['cpuPercent'] = float(row['CPUPerc'].rstrip('%'))
                row['networkBytes'] = [size(x) for x in row['NetIO'].split('/')]
                row['blockIoBytes'] = [size(x) for x in row['BlockIO'].split('/')]
            processes = []
            for pid in args.pid:
                fields = command('ps', '-p', str(pid), '-o', 'pid=,rss=,pcpu=,time=').split()
                if len(fields) != 4:
                    raise RuntimeError('A selected host process disappeared')
                processes.append({'pid': int(fields[0]), 'rssBytes': int(fields[1]) * 1024, 'cpuPercent': float(fields[2]), 'cumulativeCpuTime': fields[3]})
            states = json.loads(command('docker', 'inspect', *sorted(ids)))
            lifecycle = [{'id': c['Id'], 'running': c['State']['Running'], 'restartCount': c['RestartCount'], 'startedAt': c['State']['StartedAt']} for c in states]
            emit({'kind': 'sample', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'elapsedSeconds': time.monotonic() - start, 'containers': snapshots, 'processes': processes, 'lifecycle': lifecycle})
            count += 1
            remaining = args.duration - (time.monotonic() - start)
            if remaining <= 0:
                break
            time.sleep(min(args.interval, remaining))
        emit({'kind': 'complete', 'samples': count, 'elapsedSeconds': time.monotonic() - start})
    print(json.dumps({'output': str(args.output), 'samples': count}))


if __name__ == '__main__':
    main()
