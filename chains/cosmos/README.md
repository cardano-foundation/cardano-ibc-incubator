# Local Cosmos compatibility profiles

This directory provides reproducible `simd` chains for validating the Cardano
IBC integration against multiple ibc-go generations. Each image is built from
an official ibc-go tag, verifies the tag's immutable commit, and patches that
simapp with this repository's matching `08-cardano-probabilistic` light client.

## Profiles

| Profile | ibc-go source | Go builder | Semantics | Chain ID | RPC | gRPC | REST | Compatibility status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `v8-classic` | `v8.7.0` (`53eaba19375dab0145509af101dbce193284ec5d`) | `golang:1.21-alpine3.18` | IBC Classic | `v8-classic-1` | `26757` | `9100` | `1327` | Enabled |
| `v10-classic` | `v10.2.0` (`e120ef5d4778c3e659ce57b59f028b250be5bb2e`) | `golang:1.23.8-alpine` | IBC Classic | `v10-classic-1` | `26857` | `9110` | `1338` | Enabled |
| `v10-v2` | `v10.2.0` (`e120ef5d4778c3e659ce57b59f028b250be5bb2e`) | `golang:1.23.8-alpine` | IBC v2 | `v10-v2-1` | `26957` | `9120` | `1347` | Deferred |

The canonical machine-readable values are in [`profiles.yml`](profiles.yml).
The v10 simapp contains upstream IBC v2 transfer routing. Cardano/Hermes route
and token-swap compatibility tests remain Classic-only for now, so selecting
`v10-v2` for either workflow returns an explicit deferred-testing error.

## Start, inspect, and stop a profile

Install `caribic` from this repository, then select a profile by network name:

```sh
caribic chain start --chain cosmos --network v8-classic
caribic chain health --chain cosmos --network v8-classic
caribic chain stop --chain cosmos --network v8-classic
```

Replace `v8-classic` with `v10-classic` or `v10-v2` to select either v10
profile. A normal start stops the old container and recreates deterministic
genesis. Preserve the existing home when needed with:

```sh
caribic chain start --chain cosmos --network v10-classic --chain-flag stateful=true
```

State is stored under `~/.caribic/cosmos-profiles/<profile>`. RPC endpoints use
the host ports in the table; for example:

```sh
curl -fsS http://127.0.0.1:26757/status | jq '.result.node_info.network'
```

The same images can be managed directly from the repository root:

```sh
docker compose -f chains/cosmos/docker-compose.yml \
  --profile v8-classic up --build -d v8-classic
docker compose -f chains/cosmos/docker-compose.yml \
  --profile v8-classic down
```

## Deterministic genesis

All profiles use revision-suffixed chain IDs, the same fixed genesis time, and
the same test-only validator, relayer, and demo mnemonics recorded in
[`profiles.yml`](profiles.yml). Fixed test-only CometBFT node and consensus keys
ensure clean starts reproduce the same genesis for a given profile. The
relayer and demo addresses are:

| Account | Address | Initial balance |
| --- | --- | --- |
| `relayer` | `cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt` | `100000000000stake,100000000000utest` |
| `demo` | `cosmos1eqt75k80sh3wcqzkr07k0ynyydc50932sc8uxf` | `100000000000stake,100000000000utest` |

Genesis explicitly allows both `07-tendermint` and
`08-cardano-probabilistic`. The `utest` denom has deterministic metadata and is
used for the Classic return leg. These public keys and mnemonics are strictly
for local testing.

## Classic Cardano routes and token-swap demo

Start the Cardano stack and one Classic profile, then select that same profile
for route setup and the demo:

```sh
caribic start --clean
caribic chain start --chain cosmos --network v8-classic
caribic setup route --from cardano --to cosmos --to-network v8-classic
caribic demo token-swap --chain cosmos --network v8-classic
```

Use `v10-classic` in all three profile arguments to exercise v10 Classic
semantics. Before route setup, build the repository's Hermes binary and run the
normal relayer setup so `~/.hermes/config.toml` exists. Starting a Classic
profile then adds or updates its Hermes chain block and restores the funded,
deterministic relayer key.

The `v10-v2` lifecycle profile is available now:

```sh
caribic chain start --chain cosmos --network v10-v2
caribic chain health --chain cosmos --network v10-v2
```

IBC v2 route/channel creation and transfer assertions are intentionally left
for the later v2 compatibility phase.

## Classic profile smoke test

The reproducibility smoke test builds both supported Classic images from clean
state, checks their pinned identity and API endpoints, verifies the Cardano
client registration, confirms both deterministic funded accounts, and compares
the genesis SHA-256 across two clean starts of each profile:

```sh
./chains/cosmos/scripts/smoke_test_classic_profiles.sh
```

It intentionally excludes `v10-v2`. Stop any normal compatibility-profile
containers first because the smoke test uses the documented host ports.
