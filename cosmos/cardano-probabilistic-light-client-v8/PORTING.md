# Porting Notes

## Current Target

This module targets Cosmos SDK `v0.50.14` and `ibc-go/v8.7.0`.

## Other Cosmos SDK v8 Targets

Cosmos SDK chains must compile and register custom IBC light clients in the chain binary. A relayer cannot dynamically install this module on a running chain.

This document assumes the target chain uses `ibc-go/v8`. The exact port still depends on the target chain's Cosmos SDK, CometBFT, Go, and any fork-specific replacements.

## Expected Porting Work

1. Identify the target chain's Cosmos SDK, `ibc-go/v8`, CometBFT, Go, and module replacement versions.
2. Create a compatibility branch or module variant for that dependency set.
3. Keep the protobuf package and type URLs aligned with `/ibc.lightclients.probabilistic.v1.*`.
4. Wire the app by registering the concrete types with the interface registry and adding the probabilistic light client app module in the target chain's module list, following the local light-client module shape used by that chain.
5. Ensure the IBC client params allow `08-cardano-probabilistic`; on restricted networks this requires governance or genesis/config changes in addition to the binary change.
6. For first installation, create clients after the registered module is deployed. Before installation, nodes reject `/ibc.lightclients.probabilistic.v1.ClientState` as an unresolved type URL. For an ordinary compatible software update, retain the original client IDs and stores; do not re-run client creation as an upgrade procedure.

## Existing-Client Software Upgrades

A compatible host binary replacement uses the original client stores and keeps
connections, channels, escrow and voucher identities. This requires stable
client/type identities, safe historical-state decoding and defined verifier-rule
activation. Test the exact old/new artifacts and apply any required host app
migration before normal operation.

First installation, compatible software upgrades, substitute-client recovery,
standard IBC `MsgUpgradeClient`, and incompatible client/state migrations are
separate operations. Standard IBC upgrade verification remains unsupported;
that does not prevent compatible host software upgrades. Compatibility policy
and external tests alone do not require publishing a new light-client module.

## Temporal State Compatibility

Only snapshot storage version `2` is supported. The `storage_version` field is a format marker and is not a mode selector. Version `0` records are rejected. There is no automatic migration path from inline records. Such deployments need a separately audited host migration or new clients and routes.

Create a trusted bootstrap bundle with `go run ./cmd/bootstrap`. Configure Hermes with `probabilistic_bootstrap_file`. The bundle supplies small creation records and bounded imports. Full stake tables and historical verification collections are preparation inputs only. They cannot be installed in `ClientState` or `ConsensusState`.

Clients must set a positive `max_clock_drift` and authenticate `latest_checkpoint_slot` and `latest_checkpoint_timestamp` at their checkpoint. There is no consensus-timestamp fallback for a missing cursor. The host must mount `SharedStoreKey` and register the module's genesis export/import handlers. These preserve the authenticated snapshot objects as well as the IBC client metadata.

The host must call `cardanoprobabilistic.InstallHostLiveness(app)` after setting its ante handler and before sealing the application. The local v8 and v10 SimApp patch installs this hook. It records every block in two fixed-size records in the existing IBC store. The ante wrapper makes this record available to the verifier before IBC's packet checks. A host with different hooks must provide equivalent integration. Unwired proof verification fails closed.

A gap greater than 10 seconds between recorded block timestamps starts a fresh twelve-hour host window. Missing tracking data, discontinuous heights and non-increasing time also start a new window. Ordinary blocks retain the deadline across restarts. Proofs require both their epoch deadline and this host deadline to have elapsed. A block strictly after the later deadline must also have committed before proofs execute. Challenges remain admissible throughout the window. The snapshot-only hook uses a new continuity record key. Upgrading from the shorter-window implementation starts conservatively from the first recorded block. Old deadlines cannot shorten the new window.

These timing rules are consensus changes for the maintained local profiles. Deploy them at a coordinated application upgrade. CometBFT timestamps reflect signed commits, so the guard detects an interruption when that gap appears in committed host time. It does not detect watcher outages or guarantee inclusion against censorship. Public destinations still need an approved block-gap bound and demonstrated challenge transport, gas and inclusion capacity.
