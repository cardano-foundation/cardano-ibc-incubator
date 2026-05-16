# Porting Notes

## Current Target

The extracted module currently targets Cosmos SDK `v0.53.0` and `ibc-go/v10.2.0`. It uses the `ibc-go/v10` light-client module route:

```go
clientKeeper.AddRoute(probabilistic.ModuleName, &probabilisticLightClientModule)
```

and implements `exported.LightClientModule`.

## Injective Target

The current upstream `InjectiveFoundation/injective-core` `master` branch uses:

```text
github.com/cosmos/cosmos-sdk v0.50.13
github.com/cosmos/ibc-go/v8 v8.6.1
replace github.com/cosmos/cosmos-sdk => github.com/InjectiveLabs/cosmos-sdk v0.50.13-evm-comet1-inj.3
replace github.com/cosmos/ibc-go/v8 => github.com/InjectiveLabs/ibc-go/v8 v8.7.0-evm-comet1-inj
```

Injective `ibc-go/v8` does not use the `exported.LightClientModule` route API. Its light clients implement the legacy `exported.ClientState` methods directly, and the IBC keeper addresses client stores through `ClientKeeper.ClientStore(ctx, clientID)`.

## Expected Porting Work

1. Create an Injective-compatible branch or module variant targeting `github.com/cosmos/ibc-go/v8` with Injective's `replace` directives.
2. Remove the `LightClientModule` adapter from the v8 build and expose the legacy `ClientState` implementation directly.
3. Restore the full `exported.ClientState` surface expected by `ibc-go/v8`, including `GetLatestHeight`, `Status`, `Initialize`, `VerifyMembership`, `VerifyNonMembership`, `VerifyClientMessage`, `CheckForMisbehaviour`, `UpdateState`, `UpdateStateOnMisbehaviour`, `CheckSubstituteAndUpdateState`, `VerifyUpgradeAndUpdateState`, and `ExportMetadata`.
4. Keep the protobuf package and type URLs aligned with `/ibc.lightclients.probabilistic.v1.*`.
5. Wire the app by registering the concrete types with the interface registry and adding `probabilistic.NewAppModule()` in the Injective app module list, following the `07-tendermint` module shape in `ibc-go/v8`.
6. Ensure the IBC client params allow `08-cardano-probabilistic`; on restricted networks this requires governance or genesis/config changes in addition to the binary change.
7. Re-run client creation against Injective testnet after a binary with this module is deployed. Without that chain upgrade, Injective nodes will continue rejecting `/ibc.lightclients.probabilistic.v1.ClientState` as an unresolved type URL.

## Compatibility Risk

The cryptographic and Cardano proof logic should not need to change for the v8 port. The main risk is integration surface drift between `ibc-go/v10` and Injective's forked `ibc-go/v8`: keeper wiring, module registration, and client params are different enough that the port should be validated inside an Injective app build, not only inside this standalone module.
