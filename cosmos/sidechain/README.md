# Cardano IBC Packet-Forwarding Chain

This Cosmos SDK chain is used as a dedicated packet-forwarding chain between Cardano and other Cosmos chains. In this repo it lives in `cosmos/sidechain/`, and the binary is named `sidechaind`.

## Get started

```sh
ignite chain serve -y
```

`serve` command installs dependencies, builds, initializes, and starts your blockchain in development.

### Configure

Your blockchain in development can be configured with `config.yml`.

### IBC client type

This chain tracks Cardano via a custom IBC light client (client type `08-cardano`) using protobuf types under `ibc.lightclients.mithril.v1` (see `cosmos/sidechain/proto/ibc/lightclients/mithril/v1/mithril.proto`).

In the repo’s standard developer workflow, Hermes drives client creation/updates and handshake/packet relaying end-to-end via the Gateway and Cardano devnet. For that reason, we do not keep static JSON fixtures for Mithril client creation in this folder, since the values are deployment-specific (for example, the HostState NFT identifiers and the certified HostState transaction evidence).

Legacy Ouroboros/Cardano client JSON examples are kept under `cosmos/sidechain/exampleCall/legacy-ouroboros/` for reference only and are not part of the production flow.

## Debug with vs code

<https://docs.ignite.com/guide/debug#visual-studio-code>

```sh
ignite chain debug --server --server-address 127.0.0.1:30500
```

## Regis a validator

```sh
This script will connect to your current docker and regis a new validator

Run this to check we only have 1 validator: curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

Run this to regis new validator: cd scripts/ && ./regis-spo.sh

Run this to check we now have 2 validators: curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

```

## DeRegis a validator

```sh
Stop the running script above, then wait for about 100 blocks (~2 mins), then check we only have 1 validator: 

curl -X GET "http://localhost:1317/cosmos/base/tendermint/v1beta1/validatorsets/latest" -H  "accept: application/json"

```
