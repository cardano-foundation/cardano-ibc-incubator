#!/bin/sh

path=demo
configs_dir=examples/demo/configs

src_chain_name=ibc-0
src_port=port-99
src_chain_config_path="${configs_dir}/chains/${src_chain_name}.json"
src_mnemonic="direct language gravity into finger nurse rug rug spoon toddler music ability brisk wasp sound ball join guard pattern smooth lemon obscure raise royal"

dst_chain_name=ibc-1
dst_port=orderedtransfer
dst_chain_config_path="${configs_dir}/chains/${dst_chain_name}.json"
dst_mnemonic="engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance"

amount=2000stake
src_address=addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql

# Start the relayer
rly start $path

