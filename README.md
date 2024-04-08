# Cardano IBC Incubator
This project is working towards a bridge implementation to allow exchange of information from a Cardano blockchain to Cosmos SDK based blockchains. 

It follows the [inter-blockchain communication protocol](https://github.com/cosmos/ibc) and is trying to achieve full compliance with the parts of the specification identified necessary for the developed framework.

## :heavy_exclamation_mark: Disclaimer
Please be aware that this is an incubator project and by this means it is neither complete nor sufficiently tested at the current point in time to be used for production grade operation of a bridge. So the use of the source code and software artifacts in this repository are subject to your own discretion and risk.

:heavy_exclamation_mark: The software withing this repository is provided to you on an "as is" and "as available" basis.

While we strive for high functionality and user satisfaction and endeavour to maintain reliability and accuracy, unforeseen issues may arise due to the experimental nature of this project.

## :eyes: Overview
This repository is subdivided into three main folders:
- `cardano`: Contains all Cardano related source code that are part of the bridge as well as some facilities for bringing up a local Cardano blockchain for test and development purposes. It also contains the Aiken based Tendermint Light Client and IBC primitives implementation.
- `cosmos`: Contains all Cosmos SDK related source code including the Cardano light client (or thin client) implementation running on the Cosmos chain. The folder was scaffolded via [Ignite CLI](https://docs.ignite.com/) with [Cosmos SDK 0.50](https://github.com/cosmos/cosmos-sdk).
- `relayer`: Contains all relayer related source code. Forked from https://github.com/cosmos/relayer

## :rocket: Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Aiken](https://aiken-lang.org/installation-instructions)
- [deno](https://docs.deno.com/runtime/manual/getting_started/installation)
- [jq](https://jqlang.github.io/jq/download/)
- [git-lfs](https://git-lfs.com/)

### Cardano developer ecosystem components used
The current implementation leverages a number of frameworks maintained by the Cardano developer community. We list them here for appreciation and transparency. Without tools like those listed and others, projects like this would not be possible:
- [Pallas](https://github.com/txpipe/pallas)
- [Lucid](https://github.com/spacebudz/lucid)
- [Ogmios](https://github.com/cardanosolutions/ogmios)
- [Kupo](https://github.com/cardanosolutions/kupo)
- [db-sync](https://github.com/IntersectMBO/cardano-db-sync)

### Build from source
```sh
git lfs pull && ./build.sh
```

### Running a test environment on a local machine

```sh
./start.sh
```

Note: This will spin up a local Cardano and Cosmos blockchain and a relayer instance.

Note: On 1st start of the sidechain it might take a bit time to be readily booted. You can check in the logs if it is done via:

```sh
cd cosmos && docker compose logs sidechain-node-prod -f
```

When it look like this, you can start to check create/update client:
```sh
....
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalizing commit of block hash=2FA357EEC3EF7431C85861E3A331C7D1C8D6D8AEB9751BD3870E003B300F45A7 height=8 module=consensus num_txs=0 root=9FBBFCB424872B3B764B3CEAA9079955BA02DDB1E35B29B867A8D88C7600DA03
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalized block block_app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 module=state num_txs_res=0 num_val_updates=0
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF executed block app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 
....
```

### Stopping the test environment

```sh
./stop.sh
```

### Using the faucet to create and fund accounts in the test environment

Sidechain:
```sh
curl -X POST "http://localhost:4500/" -H  "accept: application/json" -H  "Content-Type: application/json" -d "{  \"address\": \"cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6\",  \"coins\": [    \"10token\",\"10stake\"  ]}"
```

or access to `http://localhost:4500`

Mainchain:

```sh
cd cardano/chains
```

Open file `seed-devnet.sh`, navigate to last line, enter your address, save then run: `./seed-devnet.sh`

### Running the Aiken tests

```sh
cd cardano
aiken check
```

### Creating IBC clients, connections and channels
```sh
docker exec -it relayer sh # Access to relayer container
cd /root && ./scripts/relayer-start.sh
```

The relayer will automatically create a new client, connection and channel.

```sh
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

### Sending tokens from Cosmos to Cardano and vice versa
```sh
docker exec -it relayer sh # Access to relayer container
cd /root && ./scripts/xtransfer.sh # Start submit transfer packet
```

After running `xtransfer.sh`, the relayer will capture the packet, relay a message to Cardano, call Ack on Cosmos, and by that complete the cycle.

```sh
2024-03-04T09:26:53.779140Z	info	Successful transaction	{"provider_type": "cardano", "chain_id": "cardano", "gas_used": 0, "height": 0, "msg_types": ["/ibc.core.channel.v1.MsgRecvPacket"], "tx_hash": "a35bc010a9e5e78c88469707aa10c3501bf19e51e0539b4720d70479d44fc3bc"}
...
2024-03-04T09:27:01.748158Z	info	Successful transaction	{"provider_type": "cosmos", "chain_id": "sidechain", "packet_src_channel": "channel-7", "packet_dst_channel": "channel-7", "gas_used": 55261, "fees": "", "fee_payer": "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6", "height": 8573, "msg_types": ["/ibc.core.channel.v1.MsgAcknowledgement"], "tx_hash": "D162CC2356A09F09C80D616987FE4BE965FDEA7C3C93AC0F2D1D5BE4589C8A46"}
```

You can query balance using this endpoint:
#### Cosmos:
```sh
http://localhost:1317/cosmos/bank/v1beta1/balances/cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6
```
Notice that you will have voucher token with prefix: "ibc/"
Example:
```json
{
  "balances": [
    {
      "denom": "ibc/018463FA736C852FA78B23CE6CAE123B9182D18658E0F323B130BB4B1FBB6A52",
      "amount": "13578"
    }
  ]
}
```

#### Cardano:
```sh
http://localhost:1442/matches/addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql?unspent&order=most_recent_first
```
Notice that you will have UTXO, asset with amount 2000:
Example:
```json
[
  {
    "transaction_index": 0,
    "transaction_id": "4ceee14cffdf8a03bba53e058bc02f0ed5e3cc1169d1e45963c02b780694b1af",
    "output_index": 2,
    "address": "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
    "value": {
      "coins": 1150770,
      "assets": {
        "901a270744d7eee7a2ef5e0199a29ca2636b3ede7e6fa520aba1a1c1.84916548b2860f827f717b20796c9ddd4742325677e9534cd5e92c8ca260c553": 2000
      }
    },
    "datum_hash": null,
    "script_hash": null,
    "created_at": {
      "slot_no": 4202,
      "header_hash": "3d2e1690468685cf5c95364b7200812f7252994d6a9620be0cc1f74991656020"
    },
    "spent_at": null
  }
]
```

### Register a new stake pool on the local Cardano blockchain
```sh
cd cardano/chains && ./regis-spo.sh <name>
```

Example:

```sh
cd cardano/chains && ./regis-spo.sh alice
```

### Retire a stake pool on the local Cardano blockchain
This will sent a tx to retire your pool in the next epoch:

```sh
cd cardano/chains && ./deregis-spo.sh <name>
```

Example:

```sh
cd cardano/chains && ./deregis-spo.sh alice
```

### Register a validator on Cosmos
This script will connect to your current docker and regis a new validator

```sh
Run this to check we only have 1 validator: curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

Run this to regis new validator: cd cosmos/scripts/ && ./regis-spo.sh

Run this to check we now have 2 validators: curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

```

### Unregister a validator on Cosmos
Stop the running script above, then wait for about 100 blocks (~2 mins), then check we only have 1 validator:

```sh
curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"
```

### Test timeout packet
After successful create clients, connections, channels, terminate that terminal(A).

```sh
Access this url to check current balance in Cardano: http://localhost:1442/matches/addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql?unspent&order=most_recent_first

Access this url to check current balance in Cosmos: http://localhost:1317/cosmos/bank/v1beta1/balances/cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6

```
Update script `/scripts/xtransfer.sh`, `timeout-time-offset` from `1h` to `10s`

Open another terminal(B) and run:
```sh
docker exec -it relayer sh
cd /root && ./scripts/xtransfer.sh
```

Recheck you current balance, notice that your balance will be deduct.
```sh
Access this url to check current balance in Cardano: http://localhost:1442/matches/addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql?unspent&order=most_recent_first

Access this url to check current balance in Cosmos: http://localhost:1317/cosmos/bank/v1beta1/balances/cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6

```

In the terminal A, run this to execute timeout
```sh
cd /root && ./bin/rly start demo --processor legacy
```

After seeing something like `/ibc.core.channel.v1.MsgTimeout`, recheck you current balance, notice that your token will be return back.


## :blue_heart: Contributing
All contributions are welcome! Please feel free to open a new thread on the issue tracker or submit a new pull request.

Please read [Contributing](CONTRIBUTING.md) in advance. Thank you for contributing!

## :books: Additional Documents
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)
