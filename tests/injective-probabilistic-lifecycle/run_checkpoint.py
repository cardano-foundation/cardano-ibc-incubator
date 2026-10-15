#!/usr/bin/env python3
"""Run normal Hermes maintenance against Gateway and a disposable Injective node."""
import argparse
import datetime
import hashlib
import json
import re
import shutil
import contextlib
import subprocess
import time
from pathlib import Path
from harness import Node, read, write, write_text

p=argparse.ArgumentParser()
p.add_argument('output',type=Path)
p.add_argument('--resume',action='store_true')
p.add_argument('--data-volume')
p.add_argument('--maintain-substitute',action='store_true')
p.add_argument('--auto-clock',action='store_true')
p.add_argument('--profile-suffix',default='')

p.add_argument('--rpc-port',type=int,default=18957)
p.add_argument('--grpc-port',type=int,default=19090)
p.add_argument('--worker',type=Path,required=True)
p.add_argument('--gateway-port',type=int,default=15001)
p.add_argument('--manifest',type=Path,required=True)
args=p.parse_args()
root=args.output.resolve()
repo=Path(__file__).resolve().parents[2]

def helper(*command):
    return subprocess.check_output(['docker','run','--rm','-v',f'{root}:/out','local/injective-checkpoint-probe',*command],text=True)

def ns(text):
    seconds,fraction=text.removesuffix('Z').split('.') if '.' in text else (text.removesuffix('Z'),'')
    return int(datetime.datetime.fromisoformat(seconds).replace(tzinfo=datetime.timezone.utc).timestamp())*10**9+int((fraction+'0'*9)[:9])

if not (root/'network-snapshot').exists():
    shutil.copytree(Path(__file__).parent/'evidence/network-snapshot',root/'network-snapshot')
(root/'operator-address.txt').write_text(helper('address'))
helper('key','/out/operator-key.hex')
helper('checkpoint-prepare','/out','snapshots')
b=read(root/'bootstrap.json')
b.update(client=b['clients'][0],consensus=b['consensuses'][0],metadata=b['metadatas'][0])
history=read(root/'source-history.json')
initial=int(history['Consensus']['timestamp'])
node=Node(root,'local/injective-checkpoint-expiry','testnet',args.rpc_port,scenario='checkpoint-snapshots'+('-'+args.profile_suffix if args.profile_suffix else ''))
if args.data_volume=='auto': args.data_volume='checkpoint-snapshots'+'-'+hashlib.sha256(str(root).encode()).hexdigest()[:12]
node.data_volume=args.data_volume
if args.data_volume: write_text(root/'data-volume.txt',args.data_volume)
if not (node.home/'config/genesis.json').exists():
    node.initialize(b)
genesis=read(node.home/'config/genesis.json')
genesis['genesis_time']=datetime.datetime.fromtimestamp(initial//10**9,datetime.timezone.utc).isoformat().replace('+00:00','Z')
write(node.home/'config/genesis.json',genesis)
config=node.home/'config/config.toml'
write_text(config,re.sub(r'^timeout_commit = .*','timeout_commit = "1ms"',config.read_text(),flags=re.M))
app=node.home/'config/app.toml'
text=app.read_text().replace('address = "localhost:9090"','address = "0.0.0.0:9090"')
write_text(app,text)
clock=root/('clock-offset'+('-'+args.profile_suffix if args.profile_suffix else '')+'-ns')
if not clock.exists(): write_text(clock,str(initial+30*10**9-time.time_ns()))
write_text(root/'source-tip','966')
input_file=root/'worker.json'
write(input_file,{
    'maintain_substitute':args.maintain_substitute,'client_id':'08-cardano-probabilistic-0','key':str(root/'hermes-key.json'),
    'destination':{'type':'CosmosSdk','id':'injective-777','rpc_addr':f'http://127.0.0.1:{args.rpc_port}','grpc_addr':f'http://127.0.0.1:{args.grpc_port}',
        'event_source':{'mode':'pull','interval':'100ms'},'account_prefix':'inj','key_name':'checkpoint','key_store_type':'Test','key_store_folder':str(root/'hermes-destination-keys'),
        'store_prefix':'ibc','gas_price':{'price':500000000,'denom':'inj'},'default_gas':1000000,'max_gas':75000000,'gas_multiplier':1.8,'max_tx_size':900000,'compat_mode':'0.38',
        'address_type':{'derivation':'ethermint','proto_type':{'pk_type':'/injective.crypto.v1beta1.ethsecp256k1.PubKey'}}},
    'source':{'type':'Cardano','id':history['Client']['chain_id'],'gateway_url':f'http://127.0.0.1:{args.gateway_port}',
        'misbehaviour_witness_gateway_url':f'http://127.0.0.1:{args.gateway_port+1}',
        'network_id':0,'key_name':'checkpoint','key_store_type':'Test','key_store_folder':str(root/'hermes-source-keys'),
        'bridge_manifest_path':str(args.manifest.resolve()),'signing_utxo_kupo_url':'http://127.0.0.1:1','signing_ogmios_url':'http://127.0.0.1:1'}
})
input_file.with_suffix('.stop').unlink(missing_ok=True)
worker=None
records=read(root/'maintenance-progress.json') if args.resume and (root/'maintenance-progress.json').exists() else []
restarted=False
checkpoints={record['hermes']['checkpoint_height'] for record in records if record.get('hermes',{}).get('active')}
try:
    subprocess.run(['docker','run','-d','--name',node.name,'-p',f'127.0.0.1:{args.rpc_port}:26657','-p',f'127.0.0.1:{args.grpc_port}:9900',
        '-v',f'{root}:/out',*(['-v',f'{node.data_volume}:/out/{node.home.name}/data'] if node.data_volume else []),'-e','CHECKPOINT_FIXTURE_CLOCK=/out/'+clock.name,'-e','CHECKPOINT_FIXTURE_AUTO_STEP='+('1' if args.auto_clock else '0'),'-e','GOMEMLIMIT=768MiB','-e','GOGC=50',node.image,'start','--home','/out/'+node.home.name,
        '--rpc.laddr','tcp://0.0.0.0:26657','--minimum-gas-prices','500000000inj'],check=True)
    node.running=True
    for _ in range(120):
        try:
            status=node.rpc('status')
            if int(status['sync_info']['latest_block_height'])>=2: break
        except (OSError,RuntimeError): pass
        time.sleep(.5)
    else: raise RuntimeError('Injective did not start')
    if args.auto_clock:
        pause=Path(str(clock)+'.pause')
        pause.unlink(missing_ok=True)
        while True:
            status=node.rpc('status')['sync_info']
            now=ns(status['latest_block_time'])
            tip=max([966]+[int(block['height']['revision_height']) for block in history['Honest']['Blocks'] if int(block['timestamp'])<=now and int(block['height']['revision_height'])<1125])
            write_text(root/'source-tip',str(tip))
            if now>=initial+13*3600*10**9: break
            time.sleep(.05)
        pause.touch()
        try:
            transfer=read(root/'channel-init.json')
            transfer['body']['messages']=[{'@type':'/ibc.applications.transfer.v1.MsgTransfer','source_port':'transfer','source_channel':'channel-0','token':{'denom':'inj','amount':'1'},'sender':node.operator,'receiver':'cardano-test-receiver','timeout_height':{'revision_number':'0','revision_height':'0'},'timeout_timestamp':str(initial+72*3600*10**9),'memo':''}]
            write(root/'send-timeout-packet.json',transfer)
            if not args.resume:
                for name in ['channel-init','channel-ack','send-timeout-packet']:
                    result=node.send(root/(name+'.json'),name,75000000)
                    write(root/(name+'-result.json'),result)
                    assert result['committed'] and result['committed']['tx_result']['code']==0,result
                write(root/'route-setup-status.json',node.rpc('status'))
            if args.maintain_substitute and not node.store('clients/08-cardano-probabilistic-2/clientState'):
                helper('checkpoint-add-maintainer','/out','snapshots')
                for filename in read(root/'maintainer-plan.json')['files']:
                    result=node.send(root/filename,Path(filename).stem,75000000)
                    assert result['committed'] and result['committed']['tx_result']['code']==0,result
        finally: pause.unlink()
    log=(root/'hermes-worker.log').open('a' if args.resume else 'w')
    worker=subprocess.Popen([str(args.worker.resolve()),str(input_file)],stdout=log,stderr=subprocess.STDOUT)
    last_height=0
    last_print=time.monotonic()
    # Reveal source blocks only when their signed source timestamps are reached.
    # No HostState transaction is visible during the idle interval.
    stop_at=initial+140*3600*10**9
    while True:
        status=node.rpc('status')['sync_info']
        height=int(status['latest_block_height'])
        now=ns(status['latest_block_time'])
        tip=max([966]+[int(block['height']['revision_height']) for block in history['Honest']['Blocks'] if int(block['timestamp'])<=now and int(block['height']['revision_height'])<1125])
        write_text(root/'source-tip',str(tip))
        if height!=last_height and not args.auto_clock:
            # Every committed gap remains below the module's ten-second limit.
            write_text(clock,str(int(clock.read_text())+8*10**9))
            last_height=height
        if input_file.with_suffix('.progress.json').exists():
            progress=read(input_file.with_suffix('.progress.json'))
            if progress.get('active'):
                assert progress['proof_height']==966,progress
                checkpoints.add(progress['checkpoint_height'])
        if now>=initial+100*3600*10**9 and not restarted:
            if args.auto_clock: Path(str(clock)+'.pause').touch()
            try:
                input_file.with_suffix('.stop').touch()
                worker.wait(timeout=60)
                input_file.with_suffix('.stop').unlink()
                worker=subprocess.Popen([str(args.worker.resolve()),str(input_file)],stdout=log,stderr=subprocess.STDOUT)
                restarted=True
            finally:
                if args.auto_clock: Path(str(clock)+'.pause').unlink()
        if time.monotonic()-last_print>30:
            last_print=time.monotonic()
            progress=read(input_file.with_suffix('.progress.json')) if input_file.with_suffix('.progress.json').exists() else {}
            records.append({'host_height':height,'host_time':now,'source_tip':tip,'hermes':progress})
            write(root/'maintenance-progress.json',records)
            print('host height',height,'elapsed hours',(now-initial)/3.6e12,'source tip',tip,flush=True)
        if worker.poll() is not None: raise RuntimeError('Hermes exited, inspect hermes-worker.log')
        if now>=stop_at: break
        time.sleep(.05 if args.auto_clock else .005)
    input_file.with_suffix('.stop').touch()
    worker.wait(timeout=120)
    assert len(checkpoints)>=3,checkpoints
    assert progress['active'] and progress['checkpoint_timestamp']>initial+96*3600*10**9,progress
    write(root/'maintenance-result.json',{'restarted':restarted,'checkpoint_heights':sorted(checkpoints),'elapsed_hours':(now-initial)/3.6e12,'host_height':height,'normal_refresh_worker':True,'heartbeats':False,'user_activity':False})
finally:
    if worker and worker.poll() is None:
        input_file.with_suffix('.stop').touch()
        try: worker.wait(timeout=60)
        except subprocess.TimeoutExpired: worker.terminate()
    if args.auto_clock:
        Path(str(clock)+'.pause').touch()
        try:
            time.sleep(.25)
            status=node.rpc('status')['sync_info']
            write_text(clock,str(ns(status['latest_block_time'])-time.time_ns()))
        except (OSError,RuntimeError): pass
    node.stop()
