# Cardano Mithril Light Client

> [!WARNING]
> This light client is deprecated and disabled for new deployments. This
> standalone module preserves the historical Go implementation for reference
> and protobuf/type compatibility.

The IBC client type is:

```text
08-cardano-mithril
```

The protobuf package remains `ibc.lightclients.mithril.v1`, including these
wire-compatible type URLs:

```text
/ibc.lightclients.mithril.v1.ClientState
/ibc.lightclients.mithril.v1.ConsensusState
/ibc.lightclients.mithril.v1.MithrilHeader
/ibc.lightclients.mithril.v1.Misbehaviour
/ibc.lightclients.mithril.v1.Height
```

## Module

```text
github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-mithril-light-client-v10
```

The preserved implementation targets Cosmos SDK `v0.53.3` and ibc-go
`v10.2.0`. It contains the Mithril certificate, transaction-proof, HostState,
IBC membership, update, misbehaviour, and recovery verification code together
with its protobuf definitions and generated Go types.

## Status

The module is independently compiled and tested, but it is not wired into any
chain application in this repository. Its client type therefore cannot be
created or routed by any included Cosmos application.

Keeping this code as a standalone module does not reactivate Mithril or change
its trust assumptions. It only preserves the implementation and protobuf/type
compatibility for reference and potential integrations.

## Integration Requirements

Like every ibc-go v10 light client, a chain would have to compile the module
into its binary, register its concrete interfaces, add its route to the IBC
client keeper, and allow `08-cardano-mithril` in its IBC client parameters.
Those steps are documented here only to describe the module boundary; new
deployments should use the maintained `08-cardano-probabilistic` client.

## Release Tags

Because this is a nested Go module, any future preservation release must use a
directory-prefixed tag such as:

```text
cosmos/cardano-mithril-light-client-v10/v0.1.0
```
