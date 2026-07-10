# Optional Frontends

The dapps are optional bridge clients. They are not required by the core bridge
stack.

## IBC Swap

`caribic` has a dedicated target for the swap UI:

```bash
caribic start dapp
```

This target starts only `ibc-swap-client`; it does not start the explorer. The
swap UI is published at `http://localhost:3000` by default.

You can also run it directly through Compose:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
```

## IBC Explorer

The explorer is managed directly through the frontend Compose stack:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-explorer
```

It is published at `http://localhost:8082` by default. Port `8081` is reserved
by Yaci Store in the core Cardano stack.

To run both frontends with Compose:

```bash
docker compose -f dapps/docker-compose.yml up --build
```

## Default Endpoints

- Osmosis RPC: `http://localhost:26658`
- Osmosis REST: `http://localhost:1318`
- Gateway and bridge manifest: `http://localhost:8000`
- Explorer GraphQL/SubQuery: `http://localhost:3001/v1/graphql`
- Kupo and Ogmios: `http://localhost:1442,http://localhost:1337`

Override Compose values with the corresponding host variables. For example:

```bash
export IBC_EXPLORER_HOST_PORT=18080
export IBC_SWAP_GATEWAY_ENDPOINT=http://localhost:8000
export IBC_SWAP_CROSSCHAIN_SWAP_ADDRESS=<osmosis-contract-address>
docker compose -f dapps/docker-compose.yml up --build
```

The swap UI performs denom-trace lookup, route planning, and unsigned Cardano
transfer transaction construction through shared local packages. Unless
`NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL` is set, it uses the Gateway only as
the default bridge-manifest source.
