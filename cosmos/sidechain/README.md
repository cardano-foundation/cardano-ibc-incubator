# Cardano IBC Sidechain

**sidechain** is a blockchain leverages IBC to communicate with Cardano mainchain. It uses the Cosmos SDK and Tendermint and is created with Ignite.

## Get started

```sh
ignite chain serve -y
```

`serve` command installs dependencies, builds, initializes, and starts your blockchain in development.

### Configure

Your blockchain in development can be configured with `config.yml`.

### Call Create client

```sh
sidechaind tx ibc client create ./exampleCall/client.json ./exampleCall/consen.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

./sidechaind tx ibc client create ./exampleCall/client.json ./exampleCall/consen.json --from `./sidechaind keys show --address alice` --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y --dry-run 

Update client
Est : sidechaind tx ibc client update "099-cardano-0" ./exampleCall/updateClient.json --from `sidechaind keys show --address alice` --home ~/.sidechain/ --chain-id sidechain --dry-run
Exec : sidechaind tx ibc client update "099-cardano-0" ./exampleCall/updateClient.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

Verify: curl -X GET "http://localhost:1317/ibc/core/client/v1/client_states" -H  "accept: application/json"

```
