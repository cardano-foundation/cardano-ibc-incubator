# Cardano IBC Packet-Forwarding Chain

This Cosmos SDK chain is used as a dedicated packet-forwarding chain between Cardano and other Cosmos chains. The code lives in `cosmos/sidechain/` and the binary is named `sidechaind` for historical reasons.

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

sidechaind tx ibc client create ./exampleCall/client.json ./exampleCall/consen.json --from `./sidechaind keys show --address alice` --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y --dry-run

Update client
Estimate gas : sidechaind tx ibc client update "08-cardano-0" ./exampleCall/updateClient.json --from `sidechaind keys show --address alice` --home ~/.sidechain/ --chain-id sidechain --dry-run

then append `--gas XXX` to the command below

Exec : sidechaind tx ibc client update "08-cardano-0" ./exampleCall/updateClient.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

Verify: curl -X GET "http://localhost:1317/ibc/core/client/v1/client_states" -H  "accept: application/json"

```

### Test Misbehaviour Client

```sh
Create new client:
sidechaind tx ibc client create ./exampleCall/testMisbehaviour/client.json ./exampleCall/testMisbehaviour/consen.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

will return:
...
tx: null
txhash: <TX_HASH_HERE>
...


Query created client using: sidechaind q tx <TX_HASH_HERE> | grep "08-cardano-"
will return:
...
    value: <CLIENT_ID_HERE>
...

Update client, using CLIENT_ID from above:
sidechaind tx ibc client update <CLIENT_ID_HERE> ./exampleCall/testMisbehaviour/updateClient.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

Verify: curl -X GET "http://localhost:1317/ibc/core/client/v1/client_states/<CLIENT_ID_HERE>" -H  "accept: application/json"

Now submit misbehavior:
sidechaind tx ibc client update <CLIENT_ID_HERE> ./exampleCall/testMisbehaviour/misbehavior.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

Verify: curl -X GET "http://localhost:1317/ibc/core/client/v1/client_states/<CLIENT_ID_HERE>" -H  "accept: application/json"
Notice that *frozen_height* of this client changed from 0 to 1, that mark this client being frozen

```

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

### Test call update client with de/register Cert

```sh
sidechaind tx ibc client create ./exampleCall/testSPO/client.json ./exampleCall/testSPO/consen.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y

Update client

Replace "08-cardano-0" with client-id we\'ve created above

Exec with regis cert: sidechaind tx ibc client update "08-cardano-0" ./exampleCall/testSPO/regisSPO.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y --gas 360000

Exec with deregis cert: sidechaind tx ibc client update "08-cardano-0" ./exampleCall/testSPO/deregisSPO.json --from alice --home ~/.sidechain/ --chain-id sidechain --keyring-backend=test -y --gas 360000

Verify: curl -X GET "http://localhost:1317/cosmos/tx/v1beta1/txs/{tx id got from exec}" -H  "accept: application/json"

Check if there is a key: register-cert or unregister-cert
```
