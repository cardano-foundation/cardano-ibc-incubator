#!/usr/bin/env python3
"""Advance only the disposable Cardano/Cosmos producer clocks in bounded steps.

Run with Gateway/Hermes stopped, then restart them using the recorded new offset.
The on-chain approval delay and all counterparty verification rules stay intact.
"""
import argparse
import datetime
import fcntl
import json
import os
import math
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--project', required=True)
    target = p.add_mutually_exclusive_group(required=True)
    target.add_argument('--seconds', type=int)
    target.add_argument('--until-ms', type=int, help='Stop once a canonical Cardano block reaches this POSIX millisecond timestamp (at most two days ahead)')
    p.add_argument('--step-seconds', type=int, default=300,
                   help='Maximum jump between actual blocks (1–300 seconds)')
    p.add_argument('--resume', action='store_true', help='Reconcile a pending step before advancing the additional --seconds')
    p.add_argument('--file-clock', action='store_true', help='Use the shared disposable offset file; synchronize Cosmos when finished')
    args = p.parse_args()
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT/'.deployment-smoke') or not args.project.startswith('cardano-deployment-test-'):
        p.error('Only an explicit disposable deployment-test runtime is supported')
    if args.seconds is not None and (not 0 <= args.seconds <= 172800 or (args.seconds == 0 and not args.resume)):
        p.error('Advance at most two days; zero is only valid with --resume')
    if args.until_ms is not None and (args.until_ms <= 0 or args.until_ms > int(time.time()*1000)):
        p.error('A disposable clock target must be positive and no later than actual host time')
    if not 1 <= args.step_seconds <= 300: p.error('Step must be between one and 300 seconds')
    file = runtime/'compose.json'
    config = json.loads(file.read_text())
    genesis = json.loads((runtime/'runtime/genesis-shelley.json').read_text())
    if genesis['networkMagic'] != 42: p.error('Only the owned magic-42 devnet is supported')
    lock = (runtime/'clock.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    def atomic(path, value):
        temporary = path.with_name(path.name+'.pending-write')
        with temporary.open('w') as output:
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    state_file = runtime/'clock-state.json'
    pending_file = runtime/'clock-pending.json'
    if pending_file.exists() and not args.resume:
        p.error('A prior clock step is unresolved. Inspect clock-pending.json, actual producer settings and canonical history before advancing again')
    state = json.loads(state_file.read_text()) if state_file.exists() else {'offset':json.loads((runtime/'result.json').read_text())['clockOffsetSeconds'],'steps':[]}
    compose = ['docker','compose','-p',args.project,'-f',str(file)]
    nodes = ['node','spo2','spo3','spo4','spo5']
    if any(node not in config['services'] for node in nodes): p.error('Five forging pools are required')
    if state['offset'] + (args.seconds or 0) > 0: p.error('Do not advance beyond the real host clock')
    def tip(node='node'):
        return json.loads(subprocess.check_output(compose+['exec','-T',node,'cardano-cli','conway','query','tip','--testnet-magic','42'],text=True))
    def wait(description, predicate):
        end = time.monotonic()+180
        last = None
        while time.monotonic() < end:
            try:
                result = predicate()
                if result: return result
            except Exception as error: last = str(error)
            time.sleep(2)
        raise RuntimeError(f'Timed out waiting for {description}: {last}. Stop advancing and restore canonical history before resuming.')
    def synchronized_producers(minimum_slot):
        points = {node: tip(node) for node in nodes}
        for point in points.values():
            if int(point.get('slot', -1)) < minimum_slot:
                return None
            digest = point.get('hash', '')
            if not re.fullmatch('[0-9a-f]{64}', digest):
                raise RuntimeError('Malformed producer block hash')
            sql = f"SELECT count(*) FROM block WHERE number={int(point['block'])} AND slot={int(point['slot'])} AND hash='{digest}'"
            count = subprocess.check_output(compose+['exec','-T','history-db','psql','-U','postgres','-d','migration_yaci','-Atc',sql],text=True).strip()
            if count != '1':
                return None
        return points
    def finish_step(pending):
        before, advance, offset = pending['before'], pending['advance'], pending['offset']
        if offset != state['offset']+advance or not 1 <= advance <= 300:
            raise RuntimeError('Pending step does not extend the recorded bounded clock; inspect it manually')
        after = wait('a real block in the advanced clock window',lambda: (point if (point:=tip()).get('slot',0) >= before['slot']+advance-20 else None))
        # A single advancing producer is insufficient: a clock jump can leave
        # the other pools on a fork. Never advance that partition beyond its
        # rollback horizon, even though this node and Yaci still make progress.
        producers = wait('all five producers on canonical history in the advanced window',
                         lambda: synchronized_producers(before['slot']+advance-20))
        epoch = int(after['epoch'])
        def nonce_indexed():
            sql = f"SELECT count(*) FROM epoch_nonce n JOIN block b ON b.number=n.block AND b.slot=n.slot AND b.epoch=n.epoch WHERE n.epoch BETWEEN 0 AND {epoch}"
            count = subprocess.check_output(compose+['exec','-T','history-db','psql','-U','postgres','-d','migration_yaci','-Atc',sql],text=True).strip()
            return count == str(epoch+1)
        wait('complete canonical epoch nonce history',nonce_indexed)
        subprocess.run(['python3', str(ROOT/'scripts/ci/aiken-contract-migration/capture-migration-stake.py'), '--runtime', str(runtime), '--project', args.project, '--reuse-canonical-epoch'], check=True)
        state['offset'] = offset
        state['steps'].append({'advance':advance,'tip':after,'producers':producers})
        atomic(state_file, json.dumps(state,indent=2)+'\n')
        pending_file.unlink()
        return after
    if pending_file.exists():
        pending = json.loads(pending_file.read_text())
        if pending.get('fileClock'):
            if (runtime/'runtime/migration-clock.rc').read_text().strip() != f"{pending['offset']:+d}s":
                raise RuntimeError('Shared producer clock does not match the pending intent')
        elif int(config['services']['cosmos']['environment']['MIGRATION_REHEARSAL_CLOCK_OFFSET_SECONDS']) < pending['offset']:
            raise RuntimeError('Producer configuration does not match pending advancement')
        point = finish_step(pending)
        print(json.dumps({'resumedOffset':state['offset'],'canonicalTip':point}),flush=True)
    clock_file = runtime/'runtime/migration-clock.rc'
    file_clock = all(config['services'][n]['environment'].get('CARDANO_LOCAL_CLOCK_FILE') == '/runtime/migration-clock.rc' for n in nodes)
    if args.file_clock and not file_clock:
        atomic(clock_file, f"{state['offset']:+d}s\n")
        shutil.copyfile(ROOT/'chains/cardano/local-clock-entrypoint', runtime/'runtime/migration-clock-entrypoint')
        for node in nodes:
            config['services'][node]['entrypoint'] = ['/bin/sh','/runtime/migration-clock-entrypoint']
            config['services'][node]['environment']['CARDANO_LOCAL_CLOCK_FILE'] = '/runtime/migration-clock.rc'
        atomic(file, json.dumps(config,indent=2)+'\n')
        subprocess.run(compose+['up','-d',*nodes],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        wait('the producer clock-file restart',tip)
        file_clock = True
    genesis_ms = int(datetime.datetime.fromisoformat(genesis['systemStart'].replace('Z','+00:00')).timestamp()*1000)
    slot_ms = int(genesis['slotLength']*1000)
    if slot_ms <= 0: p.error('Invalid genesis slot length')
    def until_remaining(point):
        return max(0, math.ceil((args.until_ms - genesis_ms - point['slot']*slot_ms)/1000))
    remaining = args.seconds if args.until_ms is None else until_remaining(tip())
    if remaining > 172800: p.error('Clock target is more than two days ahead of the canonical tip')
    advanced = 0
    wait('all five producers synchronized before clock advancement',
         lambda: synchronized_producers(tip()['slot']-30))
    while remaining:
        subprocess.run(['python3', str(ROOT/'scripts/ci/aiken-contract-migration/capture-migration-stake.py'), '--runtime', str(runtime), '--project', args.project, '--reuse-canonical-epoch'], check=True)
        before = tip()
        if args.until_ms is not None:
            remaining = until_remaining(before)
            if remaining == 0: break
        # Large jumps can leave the local chain outside the node's forecast or
        # caught-up window. Require an accepted block after each small jump;
        # never change consensus/genesis settings to make a jump succeed.
        advance = min(remaining, args.step_seconds, int(genesis['epochLength'])-30)
        offset = state['offset']+advance
        advanced += advance
        if advanced > 172800 or offset > 0:
            raise RuntimeError('Clock advancement exceeds the disposable two-day or host-time bound')
        target = (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=offset)).strftime('%Y-%m-%d %H:%M:%S')
        for node in nodes: config['services'][node]['environment']['CARDANO_LOCAL_CLOCK_TARGET'] = target
        # An interrupted step may have advanced Cosmos before Cardano. Catch
        # Cardano up without regressing already committed Cosmos timestamps.
        cosmos_offset = max(offset, int(config['services']['cosmos']['environment']['MIGRATION_REHEARSAL_CLOCK_OFFSET_SECONDS']))
        # Persist intent before restarting. A failed step may be resumed only by
        # inspecting these actual producer settings and the canonical tip.
        pending = {'offset':offset,'before':before,'advance':advance,'fileClock':file_clock}
        atomic(pending_file, json.dumps(pending)+'\n')
        if file_clock:
            atomic(clock_file, f'{offset:+d}s\n')
        else:
            config['services']['cosmos']['environment']['MIGRATION_REHEARSAL_CLOCK_OFFSET_SECONDS'] = str(cosmos_offset)
            atomic(file, json.dumps(config,indent=2)+'\n')
            subprocess.run(compose+['up','-d',*nodes,'cosmos'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        after = finish_step(pending)
        remaining = remaining - advance if args.until_ms is None else until_remaining(after)
        print(json.dumps({'offset':offset,'epoch':after['epoch'],'height':after['block'],'remainingSeconds':remaining}),flush=True)
    if file_clock:
        cosmos_offset = max(state['offset'], int(config['services']['cosmos']['environment']['MIGRATION_REHEARSAL_CLOCK_OFFSET_SECONDS']))
        config['services']['cosmos']['environment']['MIGRATION_REHEARSAL_CLOCK_OFFSET_SECONDS'] = str(cosmos_offset)
        atomic(file, json.dumps(config,indent=2)+'\n')
        subprocess.run(compose+['up','-d','cosmos'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__ == '__main__': main()
