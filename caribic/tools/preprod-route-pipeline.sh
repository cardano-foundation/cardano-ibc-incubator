#!/bin/bash
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DEPLOYER_SK=$(cat ~/.caribic/preprod-deployer.sk)
HERMES=./relayer/target/release/hermes
CARDANO_CLIENT=${CARDANO_CLIENT:-07-tendermint-1}
CARIBIC=./caribic/target/release/caribic
gw() { docker exec gateway-app sh -c "wget -qO- -T 4 http://localhost:8000/health/ready" 2>/dev/null; }

echo "MILESTONE: pre-flight"
docker start gateway-app >/dev/null 2>&1
for i in $(seq 1 90); do gw | grep -q '"status":"ready"' && break; sleep 15; done
gw | grep -q '"status":"ready"' || { echo "FAILED: gateway not ready"; exit 1; }
echo "MILESTONE: gateway ready"

python3 - <<'PYEOF'
import os
p = os.path.expanduser('~/.hermes/config.toml')
s = open(p).read()
changed = False
if 'testnet.sentry.tm.injective.network' in s:
    s = s.replace("rpc_addr = 'https://testnet.sentry.tm.injective.network:443'", "rpc_addr = 'https://injective-testnet-rpc.polkachu.com:443'")
    changed = True
blocks = s.split('[[chains]]')
for i, b in enumerate(blocks):
    if 'injective-888' in b:
        if 'max_tx_size = 209715' in b:
            blocks[i] = b.replace('max_tx_size = 209715', 'max_tx_size = 1000000'); changed = True
        if 'max_gas = 15000000' in b:
            blocks[i] = blocks[i].replace('max_gas = 15000000', 'max_gas = 60000000'); changed = True
s = '[[chains]]'.join(blocks)
open(p, 'w').write(s)
print('hermes config verified' + (' (patched)' if changed else ''))
PYEOF

kill $(cat ~/.hermes/hermes.pid 2>/dev/null) 2>/dev/null
echo "MILESTONE: daemon stopped for handshake"

P0=$(gw | python3 -c "import sys,json; print(json.load(sys.stdin)['proofHeight'])" 2>/dev/null)
echo "MILESTONE: minting fresh anchor (proofHeight $P0)"
$HERMES update client --host-chain cardano-preprod --client "$CARDANO_CLIENT" 2>&1 | tail -1 | grep -qa SUCCESS || echo "note: anchor update reported non-success (may still land)"
for i in $(seq 1 60); do P1=$(gw | python3 -c "import sys,json; print(json.load(sys.stdin)['proofHeight'])" 2>/dev/null); [ -n "$P1" ] && [ "$P1" != "$P0" ] && break; sleep 20; done
[ "$P1" = "$P0" ] && { echo "FAILED: anchor never certified"; exit 1; }
echo "MILESTONE: anchor certified at $P1"

PROB_OUT=$($HERMES create client --host-chain injective-888 --reference-chain cardano-preprod 2>&1)
PROB=$(echo "$PROB_OUT" | grep -oE '08-cardano-probabilistic-[0-9]+' | tail -1)
[ -z "$PROB" ] && { echo "FAILED: client creation"; echo "$PROB_OUT" | tail -4; exit 1; }
echo "MILESTONE: injective-side client: $PROB"

# Tight refresh cadence during the handshakes: public injective RPCs reject
# client-update payloads beyond ~25-30 blocks of gap (HTTP 413/400 at ~1MB),
# so never let the stride grow while handshake steps wait on stability.
nohup bash -c "while true; do $HERMES update client --host-chain injective-888 --client $PROB >> /tmp/injective-client-refresh.log 2>&1; sleep 240; done" > /dev/null 2>&1 &
echo $! > /tmp/injective-client-refresh.pid
echo "MILESTONE: tight refresh loop started for $PROB (240s)"

CONN_OUT=$($HERMES create connection --a-chain cardano-preprod --a-client "$CARDANO_CLIENT" --b-client "$PROB" 2>&1)
echo "$CONN_OUT" | grep -q SUCCESS || { echo "FAILED: connection"; echo "$CONN_OUT" | grep -aE "ERROR" | tail -3 | head -c 600; exit 1; }
CONN=$($HERMES --json query connections --chain cardano-preprod 2>/dev/null | tail -1 | python3 -c "
import sys, json
r = json.load(sys.stdin).get('result', [])
ids = [c for c in r if isinstance(c, str) and c.startswith('connection-')]
print(sorted(ids, key=lambda x: int(x.split('-')[1]))[-1] if ids else '')" 2>/dev/null)
echo "MILESTONE: connection open: $CONN"
[ -z "$CONN" ] && { echo "FAILED: connection id"; exit 1; }

CHAN_OUT=$($HERMES create channel --a-chain cardano-preprod --a-connection "$CONN" --a-port transfer --b-port transfer 2>&1)
echo "$CHAN_OUT" | grep -q SUCCESS || { echo "FAILED: channel"; echo "$CHAN_OUT" | grep -aE "ERROR" | tail -3 | head -c 600; exit 1; }
CHAN=$($HERMES --json query channels --chain cardano-preprod --counterparty-chain injective-888 2>/dev/null | tail -1 | python3 -c "
import sys, json
r = json.load(sys.stdin).get('result', [])
ids = [c['channel_id'] for c in r if isinstance(c, dict) and c.get('channel_id','').startswith('channel-')]
print(sorted(ids, key=lambda x: int(x.split('-')[1]))[-1] if ids else '')" 2>/dev/null)
echo "MILESTONE: channel open: $CHAN"

echo "MILESTONE: restarting daemon"
$CARIBIC --config caribic/config/preprod-config.json start relayer --network preprod 2>&1 | tail -2

echo "MILESTONE: relaxing client refresh loop to 1200s for $PROB"
kill $(cat /tmp/injective-client-refresh.pid 2>/dev/null) 2>/dev/null
nohup bash -c "while true; do sleep 1200; $HERMES update client --host-chain injective-888 --client $PROB >> /tmp/injective-client-refresh.log 2>&1; done" > /dev/null 2>&1 &
echo $! > /tmp/injective-client-refresh.pid

echo "MILESTONE: verification transfer on $CHAN"
FT_OUT=$($HERMES tx ft-transfer --dst-chain injective-888 --src-chain cardano-preprod --src-port transfer --src-channel "$CHAN" --amount 2000000 --denom lovelace --timeout-seconds 7200 2>&1)
echo "$FT_OUT" | tail -1 | head -c 300; echo
echo "$FT_OUT" | grep -q SUCCESS || { echo "FAILED: verification transfer send"; exit 1; }
CLR_OUT=$($HERMES clear packets --chain cardano-preprod --port transfer --channel "$CHAN" 2>&1)
echo "$CLR_OUT" | grep -q SUCCESS && echo "MILESTONE: verification packet relayed"
$HERMES --json query packet pending --chain cardano-preprod --port transfer --channel "$CHAN" 2>/dev/null | tail -1 | head -c 300; echo

echo "MILESTONE: attempting timeout refund for stuck channel-5 packet"
$HERMES clear packets --chain cardano-preprod --port transfer --channel channel-5 2>&1 | tail -2 | head -c 400; echo

echo "MILESTONE: pipeline v6 complete: route $CHAN via $CONN, clients $CARDANO_CLIENT / $PROB"
