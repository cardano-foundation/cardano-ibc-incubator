# Porting Notes

## Current Target

The extracted module currently targets Cosmos SDK `v0.53.3` and `ibc-go/v10.2.0`. It uses the `ibc-go/v10` light-client module route:

```go
clientKeeper.AddRoute(probabilistic.ModuleName, &probabilisticLightClientModule)
```

and implements `exported.LightClientModule`.

## Other Cosmos SDK v10 Targets

Cosmos SDK chains must compile and register custom IBC light clients in the chain binary. A relayer cannot dynamically install this module on a running chain.

This document assumes the target chain uses `ibc-go/v10`. The exact port still depends on the target chain's Cosmos SDK, CometBFT, Go, and any fork-specific replacements.

## Expected Porting Work

1. Identify the target chain's Cosmos SDK, `ibc-go/v10`, CometBFT, Go, and module replacement versions.
2. Create a compatibility branch or module variant for that dependency set.
3. Keep the protobuf package and type URLs aligned with `/ibc.lightclients.probabilistic.v1.*`.
4. Wire the app by registering the concrete types with the interface registry and adding the probabilistic light client app module in the target chain's module list, following the local light-client module shape used by that chain.
5. Ensure the IBC client params allow `08-cardano-probabilistic`; on restricted networks this requires governance or genesis/config changes in addition to the binary change.
6. For first installation, create clients after the registered module is deployed. Before installation, nodes reject `/ibc.lightclients.probabilistic.v1.ClientState` as an unresolved type URL. For an ordinary compatible software update, retain the original client IDs and stores; do not re-run client creation as an upgrade procedure.

## Existing-Client Software Upgrades

Follow the [software-upgrade compatibility contract](../../docs/probabilistic-client-software-upgrades.md)
and [external upgrade fixtures](../../tests/probabilistic-upgrade/README.md).
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

New clients must set a positive `max_clock_drift` and must initialize `latest_checkpoint_slot` and `latest_checkpoint_timestamp` from the same authenticated Cardano anchor as `latest_checkpoint_height`. Before upgrading, a host chain must audit its stored Cardano client states. Legacy protobuf state still decodes, but `max_clock_drift` is zero and the client fails closed until an app-state migration assigns a value. After that value is set, a root-bearing legacy checkpoint can recover its missing slot from its stored consensus timestamp. A legacy rootless checkpoint has no consensus state at its checkpoint height, so the migration must also populate its slot and timestamp. The Gateway's new-client response supplies all three fields for fresh clients. Standard IBC client upgrades remain unsupported, so existing state must be migrated by the host app or the affected clients, connections, and channels must be recreated.
