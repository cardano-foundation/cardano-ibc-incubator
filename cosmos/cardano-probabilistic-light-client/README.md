# Cardano Probabilistic Light Client

This module packages the Cardano probabilistic IBC light client as a standalone Go module.

The client type is:

```text
08-cardano-probabilistic
```

The protobuf type URLs are:

```text
/ibc.lightclients.probabilistic.v1.ClientState
/ibc.lightclients.probabilistic.v1.ConsensusState
/ibc.lightclients.probabilistic.v1.ProbabilisticHeader
/ibc.lightclients.probabilistic.v1.Misbehaviour
/ibc.lightclients.probabilistic.v1.Height
```

## Module

```text
github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client
```

This initial module targets:

```text
github.com/cosmos/cosmos-sdk v0.53.0
github.com/cosmos/ibc-go/v10 v10.2.0
```

For chains that still use `ibc-go/v8.7`, use the sibling module at `cosmos/cardano-probabilistic-light-client-ibc-go-v8`.

## Integration

For an `ibc-go/v10` app, import the module and register it with the IBC client keeper:

```go
import (
	probabilistic "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client"
)

clientKeeper := app.IBCKeeper.ClientKeeper
storeProvider := clientKeeper.GetStoreProvider()
probabilisticLightClientModule := probabilistic.NewLightClientModule(appCodec, storeProvider)

clientKeeper.AddRoute(probabilistic.ModuleName, &probabilisticLightClientModule)
app.RegisterModules(probabilistic.NewAppModule(probabilisticLightClientModule))
```

The app must also register the concrete client types in its interface registry. `NewAppModule` calls `RegisterInterfaces`, so registering the app module is the usual path.

The chain's IBC client params must allow `08-cardano-probabilistic`. If the params are restricted to only `06-solomachine` and `07-tendermint`, `MsgCreateClient` will still fail even if the Go code is compiled into the binary.

## Release Tags

Because this is a nested Go module, release tags must be prefixed with the module directory:

```text
cosmos/cardano-probabilistic-light-client/v0.1.0
```

Consumers can then require it with:

```sh
go get github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client@v0.1.0
```
