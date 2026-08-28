#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$ROOT_DIR/configuration"
NETWORK_CONFIG_DIR="$CONFIG_DIR/network-config"
NODE_HOME="$NETWORK_CONFIG_DIR/validator-0"
IMAGE="${CHEQD_LOCAL_IMAGE:?CHEQD_LOCAL_IMAGE is required}"
CHAIN_ID="${CHEQD_LOCAL_CHAIN_ID:?CHEQD_LOCAL_CHAIN_ID is required}"
MONIKER="${CHEQD_LOCAL_MONIKER:?CHEQD_LOCAL_MONIKER is required}"
VALIDATOR_MNEMONIC="${CHEQD_LOCAL_VALIDATOR_MNEMONIC:?CHEQD_LOCAL_VALIDATOR_MNEMONIC is required}"
RELAYER_MNEMONIC="${CHEQD_LOCAL_RELAYER_MNEMONIC:?CHEQD_LOCAL_RELAYER_MNEMONIC is required}"

run_in_cheqd_image() {
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -v "$CONFIG_DIR:/work" \
    -w /work \
    --entrypoint /bin/bash \
    "$IMAGE" \
    -lc "$1"
}

python_patch_localnet() {
  python - "$NODE_HOME" <<'PY'
import json
import pathlib
import re
import sys

node_home = pathlib.Path(sys.argv[1])
app_toml = node_home / "config" / "app.toml"
config_toml = node_home / "config" / "config.toml"
genesis_json = node_home / "config" / "genesis.json"

# cheqd mainnet capacity snapshot, observed 2026-08-27.
BLOCK_MAX_BYTES = '3000000'
BLOCK_MAX_GAS = '30000000'
EVIDENCE_MAX_AGE_NUM_BLOCKS = '25920'
EVIDENCE_MAX_AGE_DURATION = '259200000000000'
EVIDENCE_MAX_BYTES = '5000'
STAKING_UNBONDING_TIME = '1210000s'
STAKING_MAX_VALIDATORS = 125
STAKING_MAX_ENTRIES = 7
STAKING_HISTORICAL_ENTRIES = 10000
MEMPOOL_MAX_TX_BYTES = 1048576
RPC_MAX_BODY_BYTES = 4000000

app = app_toml.read_text()
app = re.sub(r'minimum-gas-prices = ".*?"', 'minimum-gas-prices = "50ncheq"', app)
app = re.sub(r'enable = false', 'enable = true', app, count=1)
app = re.sub(r'swagger = false', 'swagger = true', app)
app = re.sub(r'enabled-unsafe-cors = false', 'enabled-unsafe-cors = true', app)
app = re.sub(r'address = "tcp://localhost:1317"', 'address = "tcp://0.0.0.0:1317"', app)
app_toml.write_text(app)

config = config_toml.read_text()
config = re.sub(r'laddr = "tcp://127\.0\.0\.1:26657"', 'laddr = "tcp://0.0.0.0:26657"', config)
config = re.sub(r'addr_book_strict = true', 'addr_book_strict = false', config)
config = re.sub(r'timeout_propose = "3s"', 'timeout_propose = "500ms"', config)
config = re.sub(r'timeout_prevote = "1s"', 'timeout_prevote = "500ms"', config)
config = re.sub(r'timeout_precommit = "1s"', 'timeout_precommit = "500ms"', config)
config = re.sub(r'timeout_commit = "5s"', 'timeout_commit = "500ms"', config)
config = re.sub(r'create_empty_blocks = false', 'create_empty_blocks = true', config)
config, max_tx_replacements = re.subn(
    r'^max_tx_bytes = .*$',
    f'max_tx_bytes = {MEMPOOL_MAX_TX_BYTES}',
    config,
    count=1,
    flags=re.MULTILINE,
)
if max_tx_replacements != 1:
    raise RuntimeError('could not set mempool max_tx_bytes in cheqd config.toml')
config, rpc_body_replacements = re.subn(
    r'^max_body_bytes = .*$',
    f'max_body_bytes = {RPC_MAX_BODY_BYTES}',
    config,
    count=1,
    flags=re.MULTILINE,
)
if rpc_body_replacements != 1:
    raise RuntimeError('could not set RPC max_body_bytes in cheqd config.toml')
config_toml.write_text(config)

genesis = json.loads(genesis_json.read_text())

def ensure_object(parent: dict, key: str) -> dict:
    value = parent.get(key)
    if not isinstance(value, dict):
        value = {}
        parent[key] = value
    return value

app_state = ensure_object(genesis, 'app_state')

tm_consensus = ensure_object(genesis, 'consensus')
tm_consensus_params = ensure_object(tm_consensus, 'params')
tm_block = ensure_object(tm_consensus_params, 'block')
tm_block['max_bytes'] = BLOCK_MAX_BYTES
tm_block['max_gas'] = BLOCK_MAX_GAS
tm_evidence = ensure_object(tm_consensus_params, 'evidence')
tm_evidence['max_age_num_blocks'] = EVIDENCE_MAX_AGE_NUM_BLOCKS
tm_evidence['max_age_duration'] = EVIDENCE_MAX_AGE_DURATION
tm_evidence['max_bytes'] = EVIDENCE_MAX_BYTES

bank = ensure_object(app_state, 'bank')
auth = ensure_object(app_state, 'auth')
globalfee = ensure_object(app_state, 'globalfee')

balances = bank.setdefault('balances', [])
for balance in balances:
    for coin in balance.get('coins', []):
        if coin.get('denom') == 'stake':
            coin['denom'] = 'ncheq'

supply = bank.setdefault('supply', [])
for coin in supply:
    if coin.get('denom') == 'stake':
        coin['denom'] = 'ncheq'

gov = ensure_object(app_state, 'gov')
params = ensure_object(gov, 'params')
if 'voting_period' in params:
    params['voting_period'] = '12s'
if 'expedited_voting_period' in params:
    params['expedited_voting_period'] = '10s'

consensus = ensure_object(app_state, 'consensus')
consensus_params = ensure_object(consensus, 'params')
if 'abci' in consensus_params and 'vote_extensions_enable_height' in consensus_params['abci']:
    consensus_params['abci']['vote_extensions_enable_height'] = '2'

staking = ensure_object(app_state, 'staking')
staking_params = ensure_object(staking, 'params')
if staking_params.get('bond_denom') == 'stake':
    staking_params['bond_denom'] = 'ncheq'
staking_params['unbonding_time'] = STAKING_UNBONDING_TIME
staking_params['max_validators'] = STAKING_MAX_VALIDATORS
staking_params['max_entries'] = STAKING_MAX_ENTRIES
staking_params['historical_entries'] = STAKING_HISTORICAL_ENTRIES

mint = ensure_object(app_state, 'mint')
mint_params = ensure_object(mint, 'params')
if mint_params.get('mint_denom') == 'stake':
    mint_params['mint_denom'] = 'ncheq'

crisis = ensure_object(app_state, 'crisis')
constant_fee = ensure_object(crisis, 'constant_fee')
if constant_fee.get('denom') == 'stake':
    constant_fee['denom'] = 'ncheq'

feemarket = ensure_object(app_state, 'feemarket')
feemarket_params = ensure_object(feemarket, 'params')
if feemarket_params.get('fee_denom') == 'stake':
    feemarket_params['fee_denom'] = 'ncheq'

for min_deposit in params.get('min_deposit', []):
    if min_deposit.get('denom') == 'stake':
        min_deposit['denom'] = 'ncheq'

for expedited_min_deposit in params.get('expedited_min_deposit', []):
    if expedited_min_deposit.get('denom') == 'stake':
        expedited_min_deposit['denom'] = 'ncheq'

bypass_messages = globalfee.setdefault('bypass_messages', [])
for message in [
    '/ibc.core.channel.v1.MsgAcknowledgement',
    '/ibc.core.client.v1.MsgUpdateClient',
    '/ibc.core.channel.v1.MsgRecvPacket',
    '/ibc.core.channel.v1.MsgTimeout',
]:
    if message not in bypass_messages:
        bypass_messages.append(message)

genesis_json.write_text(json.dumps(genesis, indent=2) + '\n')
PY
}

rm -rf "$NETWORK_CONFIG_DIR"
mkdir -p "$NODE_HOME"

run_in_cheqd_image "cheqd-noded init '$MONIKER' --chain-id '$CHAIN_ID' --home /work/network-config/validator-0 >/dev/null"
python_patch_localnet
run_in_cheqd_image "printf '%s\n' '$VALIDATOR_MNEMONIC' | cheqd-noded keys add operator-0 --keyring-backend test --home /work/network-config/validator-0 --recover >/dev/null"
run_in_cheqd_image "printf '%s\n' '$RELAYER_MNEMONIC' | cheqd-noded keys add relayer --keyring-backend test --home /work/network-config/validator-0 --recover >/dev/null"
run_in_cheqd_image "cheqd-noded genesis add-genesis-account operator-0 20000000000000000ncheq --keyring-backend test --home /work/network-config/validator-0 >/dev/null"
run_in_cheqd_image "cheqd-noded genesis add-genesis-account relayer 100001000000000000ncheq --keyring-backend test --home /work/network-config/validator-0 >/dev/null"
run_in_cheqd_image 'NODE_ID=$(cheqd-noded tendermint show-node-id --home /work/network-config/validator-0) && NODE_VAL_PUBKEY=$(cheqd-noded tendermint show-validator --home /work/network-config/validator-0) && cheqd-noded genesis gentx operator-0 1000000000000000ncheq --chain-id '"$CHAIN_ID"' --node-id "$NODE_ID" --pubkey "$NODE_VAL_PUBKEY" --keyring-backend test --home /work/network-config/validator-0 >/dev/null'
run_in_cheqd_image "cheqd-noded genesis collect-gentxs --home /work/network-config/validator-0 >/dev/null"
run_in_cheqd_image "cheqd-noded genesis validate-genesis --home /work/network-config/validator-0 >/dev/null"
