# Cardano Stability Light Client

This module packages the Cardano stability-scored IBC light client as a standalone Go module.

The client type is:

```text
08-cardano-stability
```

The protobuf type URLs remain:

```text
/ibc.lightclients.stability.v1.ClientState
/ibc.lightclients.stability.v1.ConsensusState
/ibc.lightclients.stability.v1.StabilityHeader
/ibc.lightclients.stability.v1.Misbehaviour
/ibc.lightclients.stability.v1.Height
```

## Module

```text
github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-stability-light-client
```

This initial module targets:

```text
github.com/cosmos/cosmos-sdk v0.53.0
github.com/cosmos/ibc-go/v10 v10.2.0
```

## Integration

For an `ibc-go/v10` app, import the module and register it with the IBC client keeper:

```go
import (
	stability "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-stability-light-client"
)

clientKeeper := app.IBCKeeper.ClientKeeper
storeProvider := clientKeeper.GetStoreProvider()
stabilityLightClientModule := stability.NewLightClientModule(appCodec, storeProvider)

clientKeeper.AddRoute(stability.ModuleName, &stabilityLightClientModule)
app.RegisterModules(stability.NewAppModule(stabilityLightClientModule))
```

The app must also register the concrete client types in its interface registry. `NewAppModule` calls `RegisterInterfaces`, so registering the app module is the usual path.

The chain's IBC client params must allow `08-cardano-stability`. If the params are restricted to only `06-solomachine` and `07-tendermint`, `MsgCreateClient` will still fail even if the Go code is compiled into the binary.

## Release Tags

Because this is a nested Go module, release tags must be prefixed with the module directory:

```text
cosmos/cardano-stability-light-client/v0.1.0
```

Consumers can then require it with:

```sh
go get github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-stability-light-client@cosmos/cardano-stability-light-client/v0.1.0
```
