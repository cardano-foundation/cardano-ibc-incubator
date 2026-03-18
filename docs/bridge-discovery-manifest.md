# Bridge Discovery Manifest

The Cardano bridge uses a public discovery manifest so an independent operator can bootstrap a Gateway/relayer stack without relying on hidden local deployment knowledge.

## What it is

The manifest is a versioned JSON document containing the public Cardano deployment artifacts required to discover and interact with a bridge deployment:

- Cardano chain identity
- HostState NFT identity
- handler auth token identity
- public validator metadata
  - script hashes
  - spend addresses where relevant
  - reference UTxOs
  - referred validator references for `spend_channel`
- module identifiers and addresses

It is a bootstrap artifact, not a redeployment artifact.

## What it is not

The manifest does not include:

- private keys
- Ogmios / Kupo / db-sync / Mithril endpoints
- database credentials
- script bytecode
- any other operator-local infrastructure config

An operator still needs public Cardano infrastructure access, but the bridge deployment itself is now discoverable from one public artifact.

## Gateway startup

The Gateway now supports two startup modes:

1. default / legacy mode
   - if no explicit startup source is set, the Gateway loads the default `handler.json`
2. `HANDLER_JSON_PATH`
   - explicitly load a legacy deployment artifact and derive the public manifest in-memory
3. `BRIDGE_MANIFEST_PATH`
   - explicitly load the public manifest directly

`BRIDGE_MANIFEST_PATH` is the public-manifest alternative to the legacy `handler.json` startup path.
The two env vars are mutually exclusive. If both are set, startup fails.

## Public API surface

The Gateway exposes the manifest on both transports:

- REST: `GET /api/bridge-manifest`
- gRPC: `ibc.cardano.v1.Query/BridgeManifest`

## Exporting a manifest from a legacy deployment

From `cardano/gateway`:

```bash
CARDANO_CHAIN_ID=cardano-devnet \
CARDANO_CHAIN_NETWORK_MAGIC=42 \
npm run export:bridge-manifest -- \
  ../offchain/deployments/handler.json \
  ../offchain/deployments/bridge-manifest.json
```

This reads the legacy `handler.json`, strips it down to the public bootstrap data, and writes the normalized manifest.

## Trust model

The manifest reduces operational coupling, but it does not change the bridge verification model:

- HostState NFT remains the canonical state anchor
- Gateway still reconstructs the Cardano-side IBC proof surface
- Entrypoint still verifies Mithril-backed proofs and ICS-23 proofs itself

So this change makes the bridge easier to bootstrap independently, but it does not make the Gateway a trusted consensus source.
