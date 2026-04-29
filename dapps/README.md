# Frontends

The IBC Swap UI is a demo consumer of the bridge and is started by the default
`caribic start` stack. It can also be managed independently:

```bash
caribic start dapp
caribic stop dapp
```

The explorer UI remains optional and can be started from the dedicated frontend
compose stack when needed.

Use compose directly when you want to run or debug a frontend outside the
Caribic lifecycle:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
docker compose -f dapps/docker-compose.yml up --build ibc-explorer
```

To run both:

```bash
docker compose -f dapps/docker-compose.yml up --build
```

Default host ports:

- Swap UI: `http://localhost:3000`
- Explorer UI: `http://localhost:8081`

`ibc-explorer` publishes on `8081` by default because `8080` is already used
elsewhere in the local bridge stack (for Mithril).

Default local endpoints target the host-published bridge services:

- IBC Swap mode: `local` by default; Caribic sets `testnet` when started with `--network preprod`
- Entrypoint RPC: `http://localhost:26657`
- Entrypoint REST: `http://localhost:1317`
- Osmosis RPC: `http://localhost:26658`
- Osmosis REST: `http://localhost:1318`
- Injective testnet RPC/REST: public Polkachu endpoints when `IBC_SWAP_MODE=testnet`
- Gateway: `http://localhost:8000` as the default bridge-manifest host for the swap UI
- GraphQL/SubQuery: `http://localhost:3001/v1/graphql` for explorer only
- Kupo/Ogmios: `http://localhost:1442,http://localhost:1337`

TODO: The demo dapps should not rely on the gateway long term. On this branch,
the swap UI already uses shared local packages for Cardano denom-trace lookup,
route planning, and unsigned transfer tx building; the remaining default
Gateway dependency is bridge-manifest bootstrap unless a separate manifest URL
is configured.

Override any value by exporting the corresponding compose variable before
starting the service, for example:

```bash
export IBC_EXPLORER_HOST_PORT=18080
export IBC_SWAP_MODE=testnet
export IBC_SWAP_GATEWAY_ENDPOINT=http://localhost:8000
export IBC_SWAP_CROSSCHAIN_SWAP_ADDRESS=<osmosis-contract-address>
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
```
