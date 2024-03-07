#!/bin/sh

configs_dir=examples/demo/configs
path=demo

src_chain_name=ibc-0
src_port=port-99

dst_chain_name=ibc-1
dst_port=transfer
dst_mnemonic="engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance"

amount=2000stake
src_address=addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql

# alias rly=./bin/rly

# Initialize configuration and keys
rm -rf ~/.relayer
rly config init
rly chains add-dir $configs_dir/chains
rly paths add-dir $configs_dir/paths

# Setup keys for the destination chain
rly keys restore $dst_chain_name faucet-key "$dst_mnemonic"
rly keys use $dst_chain_name faucet-key

# Establish connection
rly transact connection $path --block-history 0

# Establish channel
rly transact channel $path --src-port $src_port --dst-port $dst_port --order unordered --version ics20-1

# Start the relayer
rly start $path

