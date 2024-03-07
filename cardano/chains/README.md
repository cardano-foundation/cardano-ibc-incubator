Update `activeSlotsCoeff` in `/chains/config/devnet/genesis-shelley.json` to change block time

## PreRun:
```
Install docker compose and [jq](https://jqlang.github.io/jq/download/)
```

## Run Docker:
```sh
cd chains && ./run-docker.sh
```


## Epoch 0 nonce and poolParams:
```
Being located in chains/baseinfo/info.json

```

```json
{
  "Epoch0Nonce": "b3e68ee288af6d5bd4e883b1c37b3faa15ffe8f55b2fd1df8c2bf74dbfe2b60e",
  "poolParams": {
    "8a219b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b60": {
      "publicKey": "8a219b698d3b6e034391ae84cee62f1d76b6fbc45ddfe4e31e0d4b60",
      "rewardAccount": {
        "credential": {
          "key hash": "b6ffb20cf821f9286802235841d4348a2c2bafd4f73092b7de6655ea"
        },
        "network": "Testnet"
      },
      "vrf": "fec17ed60cbf2ec5be3f061fb4de0b6ef1f20947cfbfce5fb2783d12f3f69ff5"
    }
  }
}
```

### Stake Snapshot:
```sh
cd demo && docker compose exec cardano-node cardano-cli query stake-snapshot --all-stake-pools --testnet-magic 42
```

## Run Aiken example:
```sh
cd aikenExample

aiken check # to build

deno run --allow-net --allow-read --allow-env hello_world-lock.ts

deno run --allow-net --allow-read --allow-env hello_world-unlock.ts <txId>
```

## Run Block download:

### Get slot:
```sh
cd demo && docker compose exec cardano-node cardano-cli query tip --testnet-magic 42
```
```
{
    ...
    "hash": "40ad88ea02911d346013b32b23f8d698a33ea4d22fdb7ae7e17e7ddbfbaada48",
    "slot": 23197,
    ...
}
```
Update `hash` and `slot` to `blockDownload/src/main.rs`

### Run fetch:
```sh
cd blockDownload && cargo run
```

### Seed devnet:
```sh
cd chains && ./seed-devnet.sh address1 address2 ... addressn amount

Example: cd chains && ./seed-devnet.sh addr_test1qpk6nfguu8y6sh8c66dr5ey42zx6jmvt6s0fwam6jc9uxjgej45defy7zhtkprzjte6r7fu0y97xczydcxve9qrzxslsnzc8tu seed-addr_test1qpk6nfguu8y6sh8c66dr5ey42zx6jmvt6s0fwam6jc9uxjgej45defy7zhtkprzjte6r7fu0y97xczydcxve9qrzxslsnzc8tu 30000000
```

### Add new SPO:
```sh
cd chains && ./regis-spo.sh <name>

Example: cd chains && ./regis-spo.sh alice
```

### Retire your SPO:
```sh
cd chains && ./deregis-spo.sh <name>

This will sent a tx to retire your pool in next epoch
Example: cd chains && ./deregis-spo.sh alice
```
