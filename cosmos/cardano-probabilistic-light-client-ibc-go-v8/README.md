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
github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-ibc-go-v8
```

This module targets:

```text
github.com/cosmos/cosmos-sdk v0.53.0
github.com/cosmos/ibc-go/v8 v8.7.0
```

For `ibc-go/v10` chains, use the sibling module at `cosmos/cardano-probabilistic-light-client`.

## Integration

For an `ibc-go/v8` app, import the module and register its app module alongside the other IBC light-client modules:

```go
import (
	probabilistic "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-ibc-go-v8"
)

moduleBasics := module.NewBasicManager(
	tendermint.AppModuleBasic{},
	probabilistic.AppModuleBasic{},
)

app.mm = module.NewManager(
	tendermint.NewAppModule(),
	probabilistic.NewAppModule(),
)
```

Exact wiring varies by chain, but the app must register the concrete client types in its interface registry. `AppModuleBasic.RegisterInterfaces` calls `RegisterInterfaces`, so registering the app module basic is the usual path.

The chain's IBC client params must allow `08-cardano-probabilistic`. If the params are restricted to only `06-solomachine` and `07-tendermint`, `MsgCreateClient` will still fail even if the Go code is compiled into the binary.

## Release Tags

Because this is a nested Go module, release tags must be prefixed with the module directory:

```text
cosmos/cardano-probabilistic-light-client-ibc-go-v8/v0.1.0
```

Consumers can then require it with:

```sh
go get github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-ibc-go-v8@v0.1.0
```
