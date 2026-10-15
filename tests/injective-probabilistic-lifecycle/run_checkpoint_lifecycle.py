#!/usr/bin/env python3
"""Continue the native idle run through proofs, freezing, recovery and expiry."""
import argparse
import base64
import datetime
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path
from run import Node, read, write, write_text


def ns(value):
    seconds, _, fraction = value.removesuffix('Z').partition('.')
    return int(datetime.datetime.fromisoformat(seconds).replace(tzinfo=datetime.timezone.utc).timestamp()) * 10**9 + int((fraction + '0'*9)[:9])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('output', type=Path)
    p.add_argument('--mode', choices=['legacy', 'compact'], default='legacy')
    p.add_argument('--rpc-port', type=int, default=18957)
    p.add_argument('--grpc-port', type=int, default=19090)
    p.add_argument('--worker', type=Path, required=True)
    args = p.parse_args()
    root = args.output.resolve()
    assert read(root/'maintenance-result.json')['normal_refresh_worker']
    node = Node(root, 'local/injective-checkpoint-expiry', 'testnet', args.rpc_port, scenario='checkpoint-'+args.mode+'-auto')
    node.helper_image = 'local/injective-checkpoint-probe'
    clock = root/'clock-offset-auto-ns'
    pause = Path(str(clock)+'.pause')
    pause.touch()
    history = read(root/'source-history.json')
    initial = int(history['Consensus']['timestamp'])
    evidence = read(root/'checkpoint-lifecycle.json') if (root/'checkpoint-lifecycle.json').exists() else {}
    if 'export_import' in evidence:
        node = Node(root, node.image, 'testnet', args.rpc_port, scenario=evidence['export_import']['home'].removeprefix('testnet-'))
        node.helper_image = 'local/injective-checkpoint-probe'
    data_volume=(root/'data-volume.txt').read_text().strip() if (root/'data-volume.txt').exists() else None
    node.data_volume=(data_volume+'-imported' if 'export_import' in evidence else data_volume) if data_volume else None
    worker = None

    def mark(name, value=True):
        evidence[name] = value
        write(root/'checkpoint-lifecycle.json', evidence)
        print(name, json.dumps(value), flush=True)

    def now():
        return ns(node.rpc('status')['sync_info']['latest_block_time'])

    def start():
        subprocess.run(['docker','run','-d','--name',node.name,'-p',f'127.0.0.1:{args.rpc_port}:26657','-p',f'127.0.0.1:{args.grpc_port}:9900',
            '-v',f'{root}:/out',*(['-v',f'{node.data_volume}:/out/{node.home.name}/data'] if node.data_volume else []),'-e','CHECKPOINT_FIXTURE_CLOCK=/out/'+clock.name,'-e','CHECKPOINT_FIXTURE_AUTO_STEP=1','-e','GOMEMLIMIT=768MiB','-e','GOGC=50',node.image,
            'start','--home','/out/'+node.home.name,'--rpc.laddr','tcp://0.0.0.0:26657','--minimum-gas-prices','500000000inj'],check=True,stdout=subprocess.DEVNULL)
        node.running = True
        for _ in range(240):
            try:
                node.rpc('status')
                return
            except (OSError,RuntimeError):
                time.sleep(.5)
        raise RuntimeError('Native app did not start')

    def stop():
        pause.touch()
        time.sleep(.25)
        write_text(clock, str(now()-time.time_ns()))
        node.stop()

    def advance(target):
        pause.unlink(missing_ok=True)
        try:
            last = time.monotonic()
            while now() < target:
                if time.monotonic()-last > 30:
                    last = time.monotonic()
                    print('advancing, elapsed hours', (now()-initial)/3.6e12, flush=True)
                time.sleep(.05)
        finally:
            pause.touch()

    def state(client=0):
        raw = node.store(f'clients/08-cardano-probabilistic-{client}/clientState')
        path = root/f'live-client-{client}.pb'
        path.write_bytes(raw)
        return json.loads(node.helper('decode','/out/'+path.name))

    def native_status(client=0):
        return json.loads(node.cli('query','ibc','client','status',f'08-cardano-probabilistic-{client}','--node','http://127.0.0.1:26657','--output','json').stdout)['status']

    def hermes(client=0, action='--status', *extra):
        input = read(root/'worker.json')
        input.update(client_id=f'08-cardano-probabilistic-{client}', maintain_substitute=False)
        path = root/f'action-{client}.json'
        write(path,input)
        result = subprocess.run([str(args.worker.resolve()),str(path),action,*map(str,extra)],text=True,capture_output=True,timeout=300)
        write_text(root/f'hermes-{client}-{action.removeprefix("--")}.log',result.stdout+result.stderr)
        if result.returncode:
            raise RuntimeError((result.stdout+result.stderr)[-6000:])
        return json.loads(result.stdout.strip().splitlines()[-1])

    def agree(expected, client=0):
        native = native_status(client)
        foreign = hermes(client)
        assert native == expected, (native,foreign)
        assert foreign[expected.lower()], (native,foreign)
        return {'destination':native,'hermes':foreign}

    def send(name, error=None, source=None):
        previous = next((entry for entry in node.evidence if entry['label']==name), None)
        result = previous or node.send(source or root/(name+'.json'),name,75000000)
        committed = result['committed']
        if error:
            failure = committed['tx_result']['log'] if committed else json.dumps(result['check_tx'])
            assert error.lower() in failure.lower(), failure[:2000]
            assert not result['client_changed'],name
        else:
            assert committed and committed['tx_result']['code']==0,result
        return result

    def metadata():
        return {suffix:base64.b64encode(node.store('clients/08-cardano-probabilistic-0/consensusStates/0-966'+suffix)).decode() for suffix in ['', '/processedTime', '/processedHeight']}

    def windows():
        current = state()
        deadline = max([now()]+[int(context['usable_after_unix_ns']) for context in current.get('epoch_context_challenges',[])])
        # Host continuity also needs twelve committed hours after importing/restarting.
        advance(max(deadline+10**9,now()+12*3600*10**9+10**9))

    def recover(which, proposal):
        send('recover-'+which)
        send('vote-'+which)
        for _ in range(20):
            result=json.loads(node.cli('query','gov','proposal',str(proposal),'--node','http://127.0.0.1:26657','--output','json').stdout)
            write(root/f'governance-{which}.json',result)
            if 'PROPOSAL_STATUS_PASSED' in json.dumps(result): return
            assert not any(status in json.dumps(result) for status in ['PROPOSAL_STATUS_FAILED','PROPOSAL_STATUS_REJECTED']),result
            advance(now()+60*10**9)
        raise RuntimeError('Recovery governance did not finish')

    try:
        node.helper('checkpoint-messages','/out')
        start()
        if 'restart' not in evidence:
            old = metadata()
            assert all(old.values()),old
            mark('restart',{'status':agree('Active'),'metadata':old,'expired_control':agree('Expired',1)})
        if 'export_import' not in evidence:
            before = metadata()
            client_before = node.state()
            stop()
            exported=node.cli('export','--output-document','/out/checkpoint-export.json')
            write_text(root/'checkpoint-export.log',exported.stdout+exported.stderr)
            exported=read(root/'checkpoint-export.json')
            old_home=node.home
            old_genesis=read(old_home/'config/genesis.json')
            node=Node(root,node.image,'testnet',args.rpc_port,scenario='checkpoint-'+args.mode+'-imported')
            node.helper_image='local/injective-checkpoint-probe'
            node.data_volume=data_volume+'-imported' if data_volume else None
            assert not (node.home/'data').exists(),'Use a fresh import directory'
            shutil.copytree(old_home/'config',node.home/'config',dirs_exist_ok=True)
            shutil.copytree(old_home/'keyring-test',node.home/'keyring-test')
            genesis=old_genesis
            genesis['app_state']=exported['app_state']
            genesis['initial_height']=str(int(exported['height']))
            genesis['app_hash']=''
            genesis['genesis_time']=datetime.datetime.fromtimestamp((int(clock.read_text())+time.time_ns())/1e9,datetime.timezone.utc).isoformat().replace('+00:00','Z')
            genesis['consensus']['params']=exported['consensus_params']
            genesis['consensus']['validators']=exported['validators']
            write(node.home/'config/genesis.json',genesis)
            start()
            assert metadata()==before,(metadata(),before)
            assert node.state()==client_before,'Export/import changed the client'
            mark('export_import',{'home':node.home.name,'status':agree('Active'),'metadata_preserved':True,'host_height':node.rpc('status')['sync_info']['latest_block_height']})
        if 'old_root_proofs' not in evidence:
            windows()
            send('recv-packet-966-1')
            send('timeout-old-root-966','not reached')
            assert node.store('receipts/ports/transfer/channels/channel-0/sequences/1')==b'\x01'
            assert metadata()==evidence['restart']['metadata']
            control_before=node.store('clients/08-cardano-probabilistic-1/clientState')
            send('expired-update','not active')
            send('unauthorized-recovery-control','unauthorized')
            assert node.store('clients/08-cardano-probabilistic-1/clientState')==control_before
            mark('old_root_proofs',{'valid_packet_received':True,'timeout_rejected':True,'old_timestamp_preserved':True,'elapsed_hours':(now()-initial)/3.6e12})
        if 'frozen' not in evidence:
            path=root/'watcher.json'
            input=read(root/'worker.json')
            input['maintain_substitute']=False
            write(path,input)
            path.with_suffix('.stop').unlink(missing_ok=True)
            (root/'witness-fork').touch()
            log=(root/'native-watcher.log').open('a')
            worker=subprocess.Popen([str(args.worker.resolve()),str(path)],stdout=log,stderr=subprocess.STDOUT)
            for _ in range(1200):
                if native_status()=='Frozen': break
                if worker.poll() is not None: raise RuntimeError('Watcher exited before freezing, inspect native-watcher.log')
                time.sleep(1)
            else: raise RuntimeError('Watcher did not freeze client')
            path.with_suffix('.stop').touch()
            worker.wait(timeout=120)
            worker=None
            (root/'witness-fork').unlink()
            send('frozen-checkpoint','not active')
            mark('frozen',{'status':agree('Frozen'),'old_root_age_hours':(now()-initial)/3.6e12,'checkpoint_did_not_unfreeze':True})
        if 'recovered' not in evidence:
            write_text(root/'source-tip','1155')
            mark('substitute_new_proof',hermes(2,'--update',1125))
            assert int(state(2)['latest_height']['revision_height'])==1125
            send('frozen-packet','not active',root/'recv-packet-1125-2.json')
            recover('control',1)
            assert native_status(1)=='Active'
            recover('subject',2)
            assert native_status()=='Active'
            assert int(state()['latest_height']['revision_height'])==1125
            windows()
            send('recv-packet-1125-2')
            send('timeout-old-root-1125')
            for sequence in [1,2]:
                assert node.store(f'receipts/ports/transfer/channels/channel-0/sequences/{sequence}')==b'\x01'
            balance=json.loads(node.cli('query','bank','balances',node.operator,'--node','http://127.0.0.1:26657','--output','json').stdout)
            voucher='ibc/'+hashlib.sha256(b'transfer/channel-0/lovelace').hexdigest().upper()
            assert any(coin['denom']==voucher and coin['amount']=='200' for coin in balance['balances']),balance
            mark('recovered',{'status':agree('Active'),'expired_control':agree('Active',1),'packets_received':[1,2],'later_proof_height':1125,'balances':balance,'elapsed_hours':(now()-initial)/3.6e12})
        if 'expiry' not in evidence:
            current=state()
            checkpoint=int(current['latest_checkpoint_timestamp'])
            cutoff=checkpoint+96*3600*10**9
            advance(cutoff-3600*10**9)
            before=node.state()
            if args.mode=='compact':
                (root/'live-for-stage.pb').write_bytes(before)
                node.helper('checkpoint-plan','/out/live-for-stage.pb','/out/late-checkpoint-header.json','/out/late-stage')
                for i,filename in enumerate(read(root/'late-stage/plan.json')['files']):
                    send('late-'+Path(filename).stem,source=root/'late-stage'/filename)
                    assert int(state()['latest_checkpoint_timestamp'])==checkpoint
                mark('staged_before_expiry',{'checkpoint_unchanged':True,'active':agree('Active')})
            mark('before_cutoff',agree('Active'))
            advance(cutoff)
            mark('at_cutoff',{'status':agree('Expired'),'cutoff_ns':cutoff,'committed_ns':now()})
            if args.mode=='compact':
                send('activate-after-expiry','not active',root/'late-stage/activate.json')
            else:
                raw=read(root/'frozen-checkpoint.json')
                raw['body']['messages'][0]['client_message']={'@type':'/ibc.lightclients.probabilistic.v1.ProbabilisticHeader',**read(root/'late-checkpoint-header.json')}
                write(root/'late-update.json',raw)
                send('late-update','not active')
            assert int(state()['latest_checkpoint_timestamp'])==checkpoint
            mark('expiry',{'ordinary_updates_rejected':True,'checkpoint_timestamp':checkpoint,'cutoff_ns':cutoff})
        mark('complete',True)
    finally:
        if worker and worker.poll() is None:
            (root/'watcher.stop').touch()
            try: worker.wait(timeout=30)
            except subprocess.TimeoutExpired: worker.terminate()
        if node.running: stop()


if __name__=='__main__': main()
