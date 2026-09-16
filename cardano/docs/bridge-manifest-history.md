# Joining an existing bridge from its manifest

A new Gateway and relayer can identify a compatible bridge using its trusted public manifest. They do not need the original operator's tree caches or `handler.json`. They do need Cardano providers, a funded relayer key, the counterparty route, and retained chain history. Client expiry/recovery is independent of rebuilding local state.

Public-network manifests now require a `history` object. The outer contract schema remains version 4; `history.format` versions the replay requirements independently and does not change any on-chain datum or Cosmos light-client module. Older public artifacts without this object are rejected with upgrade instructions. Adding history metadata does not make an older contract schema compatible with a newer Gateway.

The fields are:

| Field | Meaning |
| --- | --- |
| `history.format` | Exactly `cardano-history-v1`. Unknown formats are rejected. |
| `history.start.slot` | Absolute Cardano slot of the replay intersection. |
| `history.start.block_hash` | Its canonical 32-byte lowercase hexadecimal block hash. |
| `history.start.block_height` | Its Cardano block number, not a slot or Cosmos height. |
| `history.host_state_nft_mint.tx_hash` | Transaction that created this deployment's HostState NFT. |
| `history.host_state_nft_mint.output_index` | Initial HostState output in that transaction. |

Numeric fields must be nonnegative safe integers; the checkpoint slot must be positive. Chain sync resumes **after** the intersection, so it must precede the initial HostState output and every published validator reference output. Public networks require an explicit point. Local development deployments may use `history.start: "origin"`.

`cardano-history-v1` requires accepted transaction CBOR and validity data, canonical blocks/transactions, spent and unspent outputs with assets and inline datums, and input/spend history from the intersection onward. Operators must retain these records, including after container replacement. A current UTxO snapshot or recent checkpoint cannot replace them. Disk requirements grow with retained history.

## Startup

Caribic reads the active network profile's manifest and takes the Yaci intersection from it. Full bridge startup also reuses that manifest when `handler.json` is absent; only an explicit forced deployment bypasses reuse. Manifests outside the checkout are copied into the existing Gateway artifact mount. A recent `YACI_SYNC_START_*` environment value cannot override that deployment boundary. Caribic reapplies the selected Yaci configuration even when the same network is already running. The existing checkpoint-specific Docker volume naming ensures a database that began later is not accidentally reused. Missing metadata, malformed points, unknown formats and wrong network identity fail startup. A forced fresh deployment instead uses the explicitly configured operator checkpoint.

Yaci replays from that point. Before accepting traffic, the Gateway checks the checkpoint against canonical indexed blocks (or its first successor when the intersection block itself was omitted), the initial HostState NFT/datum, all reference outputs and their transaction bodies, and block coverage through the independently read live HostState output. The existing tree initialization then requires the rebuilt/current tree root to match the live on-chain root. A cache does not bypass the history checks. Missing history or provider lag keeps the Gateway unready; a conflicting checkpoint fails explicitly.

`BRIDGE_HISTORY_SYNC_TIMEOUT_SECONDS` bounds cold-start waiting (default 7200, maximum 86400). Caribic allows that wait before declaring Gateway startup failed. Progress/errors appear in Gateway logs. If it times out, let indexers finish or restore the missing history and restart; do not substitute a newer checkpoint. End-to-end proof readiness is still required before the normal bridge startup proceeds to Hermes. `caribic start relayer` alone assumes a separately running, ready Gateway.

This bootstrap metadata supports the private consensus-index and historical public-tree reconstruction in PR #741, but those implementations remain on that separate PR until integrated. It does not add proof-backed contract support to a Gateway built without it.

## Deployment and export

Before submitting any deployment transaction, the offchain deployer records the selected public Yaci checkpoint. Caribic supplies all three `YACI_SYNC_START_*` values; select a stable point with sufficient epoch history before a fresh deployment, using `caribic yaci-checkpoint`. The initial HostState output reference is captured immediately after its creation. Both are saved as `history` in the handler artifact.

`npm run export:bridge-manifest -- <handler> <manifest>` verifies this metadata against retained Yaci history before publishing the manifest, waiting for indexing if needed. Export does not guess a checkpoint from `deployed_at`, which is the deployment completion time. The complete document is returned by REST `GET /api/bridge-manifest` and the additive gRPC `QueryBridgeManifestResponse.manifest_json` field. Bootstrap consumers must use the complete JSON document; the legacy typed gRPC `manifest` field contains only a subset.

Host-side export/upgrade connects to Yaci PostgreSQL at `127.0.0.1:15432` by default. Compose publishes this port on loopback only; `YACI_STORE_POSTGRES_PORT` changes it. `HISTORY_DB_URL` or the explicit `HISTORY_DB_*` settings can select another retained-history database. Container-to-container access still uses port 5432.

## Upgrading an existing artifact

Use an independently retained Yaci database covering the original deployment and at least two earlier epochs. From `cardano/gateway`:

```sh
HISTORY_DB_URL=postgresql://... npm run upgrade:bridge-history -- old-manifest.json upgraded-manifest.json
```

For a handler artifact, also set `CARDANO_CHAIN_NETWORK_MAGIC` and `CARDANO_CHAIN_ID`. The command finds and verifies the original HostState creation output, selects a canonical point before the deployment's required outputs with an epoch margin, verifies coverage and writes a new file. It refuses an existing output path and never changes contracts, contract schema versions, script hashes or deployment identity. Point the network profile at the resulting compatible manifest; upgrading a handler requires exporting it afterward.

If original history is unavailable, the command fails. Do not fill these fields with the current tip or fabricated hashes. Checked-in historical deployment artifacts are not silently rewritten or claimed compatible with new contracts.

## Validation scope

PostgreSQL fixture tests cover complete cold coverage, omitted intersection blocks, wrong/late checkpoints, missing transaction bodies, missing/invalid creation outputs, missing live outputs and block gaps. Startup tests ensure readiness waits for reconstruction and fails after its deadline. Rust tests check network/format validation and deployment-stable checkpoint parsing. These tests do not establish the throughput or elapsed sync time of a month-old live testnet bridge.

On 2026-09-16, a fresh Preview deployment built from main `a1fc564d04aa8edc6326037a707fb86c72f7ecde` was verified against live chain data: all 28 reference scripts matched the rebuilt deployment plan, all 55 deployment transactions had canonical history and retained CBOR, and the Gateway tree-store reconstruction from the public manifest matched the live HostState root without the original handler or a tree cache. The checks also found all three registered ports and all 17 trace-registry outputs. The [deployment verification record](../../manifests/preview/cardano-preview-deployment-verification.json) records the source/build identity, replay boundary and results. This verifies fresh-deployment bootstrap; it does not replace a month-old deployment replay or an end-to-end counterparty route test.
