#!/bin/sh

path=demo
amount1=2000stake
tokenName=$(cat /root/.config/chain_handler.json | jq -r .tokens.mock)
amount2=1000-$tokenName

src_chain_name=ibc-0
src_port=port-100
src_address=addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql
src_public_key_hash=247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8

dst_chain_name=ibc-1
dst_port=transfer
dst_address=cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6

alias rly=/root/bin/rly

src_conn_id=$(rly config show --json | jq -r --arg path "$path" '.paths[$path].src."connection-id"')
dst_conn_id=$(rly config show --json | jq -r --arg path "$path" '.paths[$path].dst."connection-id"')
src_chan_id=$(rly query connection-channels $dst_chain_name $dst_conn_id --reverse --limit 1  | jq '.[] | select(.state == "STATE_OPEN")' | jq -r '.counterparty.channel_id')
dst_chan_id=$(rly query connection-channels $dst_chain_name $dst_conn_id --reverse --limit 1  | jq '.[] | select(.state == "STATE_OPEN")' | jq -r '.channel_id')

echo "=================================== Transfer $amount1 from Cosmos to Cardano ==================================="
rly transact transfer $dst_chain_name $src_chain_name $amount1 \
    $src_public_key_hash $dst_chan_id --path $path --timeout-time-offset 1h

echo "=================================== Transfer $amount2 from Cardano to Cosmos ==================================="
rly transact transfer $src_chain_name $dst_chain_name $amount2 \
    $dst_address $src_chan_id --path $path --timeout-time-offset 1h