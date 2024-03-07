#!/bin/sh

path=demo
amount=2000stake

src_chain_name=ibc-0
src_port=port-99
src_address=addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql

dst_chain_name=ibc-1
dst_port=transfer

# alias rly=./bin/rly

src_conn_id=$(rly config show --json | jq -r --arg path "$path" '.paths[$path].src."connection-id"')
dst_conn_id=$(rly config show --json | jq -r --arg path "$path" '.paths[$path].dst."connection-id"')
src_chan_id=$(rly query connection-channels $dst_chain_name $dst_conn_id --reverse --limit 1 | jq -r '.counterparty.channel_id')
dst_chan_id=$(rly query connection-channels $dst_chain_name $dst_conn_id --reverse --limit 1 | jq -r '.channel_id')

# xtransfer from dst to src
rly transact transfer $dst_chain_name $src_chain_name $amount \
    $src_address $dst_chan_id --path $path --timeout-time-offset 1h