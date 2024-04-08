#!/usr/bin/env bash
CONTAINER_SERVICE_NAME=sidechain-node-prod
CHAIN_ID=sidechain
SCRIPT_DIR=$(dirname $(realpath $0))
cd ..
SIDECHAIN_DIR=$(pwd)

if [ "$#" -eq 0 ]; then
  # Set default values
  name="andy"
else
  name="${!#}"
fi

##########################
# Helper funcs
DOCKER_COMPOSE_CMD=
if docker compose --version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  DOCKER_COMPOSE_CMD="docker-compose"
fi

function cli() {
  ${DOCKER_COMPOSE_CMD} exec ${CONTAINER_SERVICE_NAME} ${@}
}

function cliSidechaind() {
  cli sidechaind ${@}
}

function is_gnu_sed(){
  sed --version >/dev/null 2>&1
}

function sed_i_wrapper(){
  if is_gnu_sed; then
    $(which sed) "$@"
  else
    a=()
    for b in "$@"; do
      [[ $b == '-i' ]] && a=("${a[@]}" "$b" "") || a=("${a[@]}" "$b")
    done
    $(which sed) "${a[@]}"
  fi
}
##########################

DOCKER_HOME=$(${DOCKER_COMPOSE_CMD} exec ${CONTAINER_SERVICE_NAME} sh -c "echo \$HOME")
echo $DOCKER_HOME

BALANCE=$(cliSidechaind q bank balance alice token)
echo $BALANCE

cliSidechaind init $name --chain-id="${CHAIN_ID}" --home="$DOCKER_HOME/.$name"

cp $SCRIPT_DIR/config.toml $SCRIPT_DIR/$name-config.toml 

seed=$(cli cat $DOCKER_HOME/.sidechain/config/genesis.json  | jq -r '.app_state.genutil.gen_txs[0].body.memo')

blockData=$(curl http://localhost:26657/block)

trustedHeight=$(echo $blockData | jq -r '.result.block.header.height')
trustedHash=$(echo $blockData | jq -r '.result.block_id.hash')

echo $seed
echo $trustedHeight
echo $trustedHash

sed_i_wrapper -i "s/xnode_name/${name}/g" "$SCRIPT_DIR/$name-config.toml"
sed_i_wrapper -i "s/xrpc_port/36667/g" "$SCRIPT_DIR/$name-config.toml"
sed_i_wrapper -i "s/xp2p_port/36666/g" "$SCRIPT_DIR/$name-config.toml"
sed_i_wrapper -i "s/seeds = \"\"/seeds = \"$seed\"/g" "$SCRIPT_DIR/$name-config.toml"
sed_i_wrapper -i "s/persistent_peers = \"\"/persistent_peers = \"$seed\"/g" "$SCRIPT_DIR/$name-config.toml"
sed_i_wrapper -i "s/trust_height = 0/trust_height = $trustedHeight/g" "$SCRIPT_DIR/$name-config.toml"
sed_i_wrapper -i "s/trust_hash = \"\"/trust_hash = \"$trustedHash\"/g" "$SCRIPT_DIR/$name-config.toml"

# sed_i_wrapper -i "s/172\.18\.0\.2/localhost/g" "$SCRIPT_DIR/$name-config.toml"

$DOCKER_COMPOSE_CMD cp "$SCRIPT_DIR/$name-config.toml" $CONTAINER_SERVICE_NAME:"$DOCKER_HOME/.$name/config/config.toml"
$DOCKER_COMPOSE_CMD cp "$SCRIPT_DIR/app.toml" $CONTAINER_SERVICE_NAME:"$DOCKER_HOME/.$name/config/app.toml"

rm -f $SCRIPT_DIR/$name-config.toml

cli cp $DOCKER_HOME/.sidechain/config/genesis.json $DOCKER_HOME/.$name/config/genesis.json



timestamp=$(date +%s)
newKey="${name}-${timestamp}"

cliSidechaind keys add $newKey
newKeyAddress=$(cliSidechaind keys show $newKey -a)
echo "newKeyAddress: $newKeyAddress"

cliSidechaind tx bank send zebra $newKeyAddress 1000001stake -y --chain-id="${CHAIN_ID}"

pubKeyNode=$(cliSidechaind tendermint show-validator --home="$DOCKER_HOME/.$name" | jq -r '.key')

cat > $SCRIPT_DIR/$name-validator.json << EOF
{
    "pubkey": {
        "@type": "/cosmos.crypto.ed25519.PubKey",
        "key": "${pubKeyNode}"
    },
    "amount": "1000000stake",
    "moniker": "${newKey}",
    "commission-rate": "0.1",
    "commission-max-rate": "0.2",
    "commission-max-change-rate": "0.01",
    "min-self-delegation": "1"
}
EOF

$DOCKER_COMPOSE_CMD cp "$SCRIPT_DIR/$name-validator.json" $CONTAINER_SERVICE_NAME:"$DOCKER_HOME/.$name/config/validator.json"

rm -f $SCRIPT_DIR/$name-validator.json

cliSidechaind tx staking create-validator $DOCKER_HOME/.$name/config/validator.json --from="$newKey" --chain-id="${CHAIN_ID}" -y --home="$DOCKER_HOME/.sidechain/"

# Start node and run sync 
cliSidechaind start --x-crisis-skip-assert-invariants --home="$DOCKER_HOME/.$name"