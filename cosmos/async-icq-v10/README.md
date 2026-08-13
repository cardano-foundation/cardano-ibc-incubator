# Async-ICQ Host for ibc-go v10

This standalone Go module implements the host side of asynchronous interchain
queries for Cosmos SDK applications using ibc-go v10. It preserves the generic
host implementation independently of any particular chain application or query
service.

The IBC port and channel version are:

```text
icqhost
icq-1
```

## Module

```text
github.com/cardano-foundation/cardano-ibc-incubator/cosmos/async-icq-v10
```

The module targets Cosmos SDK `v0.53.3` and ibc-go `v10.2.0`.

## Integration

An integrating application supplies its gRPC query router and an explicit
allowlist of query paths, then registers the returned IBC module on its router:

```go
import asyncicq "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/async-icq-v10"

icqHost := asyncicq.NewIBCModule(app.GRPCQueryRouter(), []string{
	"/example.v1.Query/Item",
})

ibcRouter.AddRoute(asyncicq.PortID, icqHost)
```

Query policy remains application-specific. An empty allowlist rejects every
incoming query.

The dormant VesselOracle contract and Cardano Gateway adapter are retained
separately for possible future activation; see
[`docs/vesseloracle.md`](../../docs/vesseloracle.md).

## Host Guarantees

The host accepts only unordered `icq-1` channels on `icqhost`. It rejects
non-allowlisted paths, proof requests, and query heights other than zero or the
current execution height. Queries run in a discarded cache context so a routed
handler cannot persist writes or leak SDK events; out-of-gas panics still
propagate to preserve normal Cosmos SDK gas semantics.

## Release Tags

Because this is a nested Go module, releases use directory-prefixed tags such
as:

```text
cosmos/async-icq-v10/v0.1.0
```
