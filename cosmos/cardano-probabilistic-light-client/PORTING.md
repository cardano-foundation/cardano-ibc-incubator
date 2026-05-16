# Porting Notes

## Current Target

The extracted module currently targets Cosmos SDK `v0.53.0` and `ibc-go/v10.2.0`. It uses the `ibc-go/v10` light-client module route:

```go
clientKeeper.AddRoute(probabilistic.ModuleName, &probabilisticLightClientModule)
```

and implements `exported.LightClientModule`.

## Other Cosmos SDK Targets

Cosmos SDK chains must compile and register custom IBC light clients in the chain binary. A relayer cannot dynamically install this module on a running chain.

The exact port depends on the target chain's Cosmos SDK, `ibc-go`, CometBFT, and any fork-specific replacements. Older `ibc-go` versions may not use the `exported.LightClientModule` route API. For example, `ibc-go/v8` light clients implement the legacy `exported.ClientState` methods directly, and the IBC keeper addresses client stores through `ClientKeeper.ClientStore(ctx, clientID)`.

## Expected Porting Work

1. Identify the target chain's Cosmos SDK, `ibc-go`, CometBFT, Go, and module replacement versions.
2. Create a compatibility branch or module variant for that dependency set.
3. If the target `ibc-go` version does not support `exported.LightClientModule`, remove the `LightClientModule` adapter from that build and expose the legacy `ClientState` implementation directly.
4. Restore the full `exported.ClientState` surface expected by `ibc-go/v8`, including `GetLatestHeight`, `Status`, `Initialize`, `VerifyMembership`, `VerifyNonMembership`, `VerifyClientMessage`, `CheckForMisbehaviour`, `UpdateState`, `UpdateStateOnMisbehaviour`, `CheckSubstituteAndUpdateState`, `VerifyUpgradeAndUpdateState`, and `ExportMetadata`.
5. Keep the protobuf package and type URLs aligned with `/ibc.lightclients.probabilistic.v1.*`.
6. Wire the app by registering the concrete types with the interface registry and adding the probabilistic light client app module in the target chain's module list, following the local light-client module shape used by that chain.
7. Ensure the IBC client params allow `08-cardano-probabilistic`; on restricted networks this requires governance or genesis/config changes in addition to the binary change.
8. Re-run client creation after a binary with this module is deployed. Without that chain upgrade, nodes will continue rejecting `/ibc.lightclients.probabilistic.v1.ClientState` as an unresolved type URL.
