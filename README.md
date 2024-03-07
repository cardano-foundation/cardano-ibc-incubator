# IBC Cardano Cosmos

## System overview

This repo have 3 folders:
- cardano: this folder contain the Cardano chain and also a service named `gateway`, `cardano-node-services` to support replayer fetch/submit IBC related action to Cardano
- cosmos: this folder contain the Cosmos chain, also the module Cardano client
- relayer: this folder contain code of the relayer

## Prerequire:
- Install docker, aiken, deno and jq

## Building services

```sh
./build.sh
```

## Run Cardano chain, Cosmos chain and relayer

```sh
./start.sh

Note: sidechain 1st start take a bit time to sprint up, you can view it logs using:
cd cosmos && docker compose logs sidechain-node-prod -f

When it look like this, you can start to check create/update client:
....
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalizing commit of block hash=2FA357EEC3EF7431C85861E3A331C7D1C8D6D8AEB9751BD3870E003B300F45A7 height=8 module=consensus num_txs=0 root=9FBBFCB424872B3B764B3CEAA9079955BA02DDB1E35B29B867A8D88C7600DA03
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalized block block_app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 module=state num_txs_res=0 num_val_updates=0
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF executed block app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 
....

```

## Stop Cardano chain, Cosmos chain and relayer

```sh
./stop.sh
```

## Faucet:

```sh
Sidechain:

curl -X POST "http://localhost:4500/" -H  "accept: application/json" -H  "Content-Type: application/json" -d "{  \"address\": \"cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6\",  \"coins\": [    \"10token\",\"10stake\"  ]}"

or access to http://localhost:4500

Mainchain:

cd cardano/chains

Open file seed-devnet.sh, navigate to last line, enter your address, save then run: ./seed-devnet.sh
```

## Aiken test:

```sh
cd cardano
aiken check
```

## Msg will be use when doing handshake:
### Connection:
 + /ibc.core.connection.v1.MsgConnectionOpenInit
 + /ibc.core.connection.v1.MsgConnectionOpenTry
 + /ibc.core.connection.v1.MsgConnectionOpenAck
 + /ibc.core.connection.v1.MsgConnectionOpenConfirm

### Channel:
 + /ibc.core.channel.v1.MsgChannelOpenInit
 + /ibc.core.channel.v1.MsgChannelOpenTry
 + /ibc.core.channel.v1.MsgChannelOpenAck
 + /ibc.core.channel.v1.MsgChannelOpenConfirm

## Run create client + connection + channel:
```sh
docker exec -it relayer /bin/bash # Access to relayer container
cd /home/relayer && bash relayer-start.sh

Relayer will auto create new client, connection and channel.

2024-03-04T09:22:55.419918Z	info	Starting event processor for connection handshake ...
...
2024-03-04T09:23:21.817317Z	info	Successful transaction	{"provider_type": "cardano", "chain_id": "cardano", "gas_used": 0, "height": 0, "msg_types": ["/ibc.core.connection.v1.MsgConnectionOpenInit"], "tx_hash": "289dde7686a8bf1343278ddac0e6412b3a114367cd085e1e4f26dd7e682e9021"}
...
2024-03-04T09:23:27.312094Z	info	Successful transaction	{"provider_type": "cosmos", "chain_id": "sidechain", "gas_used": 88187, "fees": "", "fee_payer": "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6", "height": 8365, "msg_types": ["/ibc.core.connection.v1.MsgConnectionOpenTry"], "tx_hash": "1D80F50E8848C00874150A3FF1457D3BDCAFE78656DBE84B3071E504C5C5FDBA"}
...
2024-03-04T09:23:28.544175Z	info	Successful transaction	{"provider_type": "cardano", "chain_id": "cardano", "gas_used": 0, "height": 0, "msg_types": ["/ibc.core.connection.v1.MsgConnectionOpenAck"], "tx_hash": "e01b3d28888d5a2fe5d94a37b7e59bd8450a81a9b8f7be8f89cd214a545a656f"}
...
2024-03-04T09:23:33.487369Z	info	Successful transaction	{"provider_type": "cosmos", "chain_id": "sidechain", "gas_used": 48037, "fees": "", "fee_payer": "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6", "height": 8371, "msg_types": ["/ibc.core.connection.v1.MsgConnectionOpenConfirm"], "tx_hash": "15B1C9AB51B5BF62844E6868F4211D49CBD8117598C03A6837A6EF1AD2612B62"}

...

2024-03-04T09:24:55.505129Z	info	Starting event processor for channel handshake ...
...
2024-03-04T09:25:31.834377Z	info	Successful transaction	{"provider_type": "cardano", "chain_id": "cardano", "gas_used": 0, "height": 0, "msg_types": ["/ibc.core.channel.v1.MsgChannelOpenInit"], "tx_hash": "c97e508b674b1ffec29ccc8b08ac2b8377c27ed872229be255a8747a1e22854a"}
...
2024-03-04T09:25:40.250480Z	info	Successful transaction	{"provider_type": "cosmos", "chain_id": "sidechain", "gas_used": 102031, "fees": "", "fee_payer": "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6", "height": 8494, "msg_types": ["/ibc.core.channel.v1.MsgChannelOpenTry"], "tx_hash": "26B7A1736F6123BA3D6C8865329B52C5EE9FECDA0ABBA39597F0FB3884FE997A"}
...
2024-03-04T09:25:41.671332Z	info	Successful transaction	{"provider_type": "cardano", "chain_id": "cardano", "gas_used": 0, "height": 0, "msg_types": ["/ibc.core.channel.v1.MsgChannelOpenAck"], "tx_hash": "d43661f0c9b02873119d3a1d8d96cdc871cb4d6f3330e4fb3f7b89ec1018b889"}
...
2024-03-04T09:25:44.371187Z	info	Successful transaction	{"provider_type": "cosmos", "chain_id": "sidechain", "gas_used": 54884, "fees": "", "fee_payer": "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6", "height": 8498, "msg_types": ["/ibc.core.channel.v1.MsgChannelOpenConfirm"], "tx_hash": "CDF370C1C2F29DCB7E7846F893B88EC870C881873622397C6AF4C31469CF802B"}

2024-03-04T09:25:44.547784Z	info	Successfully created new channel
```

## Msg will be use when doing packet relay:
 + /ibc.core.channel.v1.MsgRecvPacket
 + /ibc.core.channel.v1.MsgAcknowledgement

## Run send packet from sidechain to mainchain
```sh
Open new terminal, run

docker exec -it relayer /bin/bash # Access to relayer container
cd /home/relayer && bash xtransfer.sh # Start submit transfer packet

After run xtransfer.sh, relayer will capture packet, then do relay msg to Cardano, then later, call Ack to Cosmos, complete that cycle

2024-03-04T09:26:53.779140Z	info	Successful transaction	{"provider_type": "cardano", "chain_id": "cardano", "gas_used": 0, "height": 0, "msg_types": ["/ibc.core.channel.v1.MsgRecvPacket"], "tx_hash": "a35bc010a9e5e78c88469707aa10c3501bf19e51e0539b4720d70479d44fc3bc"}
...
2024-03-04T09:27:01.748158Z	info	Successful transaction	{"provider_type": "cosmos", "chain_id": "sidechain", "packet_src_channel": "channel-7", "packet_dst_channel": "channel-7", "gas_used": 55261, "fees": "", "fee_payer": "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6", "height": 8573, "msg_types": ["/ibc.core.channel.v1.MsgAcknowledgement"], "tx_hash": "D162CC2356A09F09C80D616987FE4BE965FDEA7C3C93AC0F2D1D5BE4589C8A46"}

```

### Add new SPO on Cardano:
```sh
cd cardano/chains && ./regis-spo.sh <name>

Example: cd cardano/chains && ./regis-spo.sh alice
```

### Retire your SPO on Cardano:
```sh
cd cardano/chains && ./deregis-spo.sh <name>

This will sent a tx to retire your pool in next epoch
Example: cd cardano/chains && ./deregis-spo.sh alice
```

### Regis a validator on Cosmos

```sh
This script will connect to your current docker and regis a new validator

Run this to check we only have 1 validator: curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

Run this to regis new validator: cd cosmos/scripts/ && ./regis-spo.sh

Run this to check we now have 2 validators: curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

```

### DeRegis a validator on Cosmos

```sh
Stop the running script above, then wait for about 100 blocks (~2 mins), then check we only have 1 validator: 

curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

```