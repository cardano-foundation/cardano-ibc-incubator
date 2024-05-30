#!/bin/sh

path=demo
amount1=2000stake
amount2=1000-9fc33a6ffaa8d1f600c161aa383739d5af37807ed83347cc133521c96d6f636b

src_chain_name=ibc-0
src_port=port-99
src_address=addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql
src_public_key_hash=247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8

dst_chain_name=ibc-1
dst_port=orderedtransfer
dst_address=cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6

alias rly=./bin/rly

src_conn_id=$(rly config show --json | jq -r --arg path "$path" '.paths[$path].src."connection-id"')
dst_conn_id=$(rly config show --json | jq -r --arg path "$path" '.paths[$path].dst."connection-id"')
src_chan_id=$(rly query connection-channels $dst_chain_name $dst_conn_id --reverse --limit 1 | jq -r '.counterparty.channel_id')
dst_chan_id=$(rly query connection-channels $dst_chain_name $dst_conn_id --reverse --limit 1 | jq -r '.channel_id')

echo "=================================== Close Ordered Channel ======================================================"
rly transact channel-close $path $src_chan_id $src_port --timeout 1h