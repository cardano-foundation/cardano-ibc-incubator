# Optional Frontends

These UI services are optional demo consumers of the bridge. They are not
started by `caribic start` and are not required for the bridge stack itself.

Use the dedicated frontend compose stack instead:

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

- Entrypoint RPC: `http://localhost:26657`
- Entrypoint REST: `http://localhost:1317`
- Osmosis RPC: `http://localhost:26658`
- Osmosis REST: `http://localhost:1318`
- Gateway: `http://localhost:8000` for swap UI tx building and Cardano asset lookup
- GraphQL/SubQuery: `http://localhost:3001/v1/graphql` for explorer only
- Kupo/Ogmios: `http://localhost:1442,http://localhost:1337`

TODO: The demo dapps should not rely on the gateway long term. Today the swap UI
still uses it for tx building and Cardano asset / denom-trace lookup, but the
target architecture is for the gateway to be only a relayer-facing component.
The next dependency for that decoupling is getting the denom trace registry
on-chain, which is still a work in progress. Once that lands, the remaining dapp
dependency on the gateway can be removed.

Override any value by exporting the corresponding compose variable before
starting the service, for example:

```bash
export IBC_EXPLORER_HOST_PORT=18080
export IBC_SWAP_GATEWAY_ENDPOINT=http://localhost:8000
export IBC_SWAP_CROSSCHAIN_SWAP_ADDRESS=<osmosis-contract-address>
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
```
