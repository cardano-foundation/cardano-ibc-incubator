#!/bin/sh

rly config init

#config of 2 chains
rly chains add-dir configs

rly paths add-dir paths

rly keys restore sidechain cosmos-key "engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance"

mkdir -p /root/.relayer/keys/cardano/keyring-test
cp -r data/cardano-key.info /root/.relayer/keys/cardano/keyring-test/
rly keys use "sidechain" "cosmos-key"
rly keys use "cardano" "cardano-key"

echo "Finish add keys."

cp -r /root/.relayer/* data/relayer

echo "Relayer start link path..."

rly transact link "path-demo-cardano"

echo "Relayer end link path. Success!"

#rly tx link cardanosidechain
#rly start cardanosidechain -t 3s
