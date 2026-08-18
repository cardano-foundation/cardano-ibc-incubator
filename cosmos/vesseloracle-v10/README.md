# VesselOracle for Cosmos SDK 0.53

This standalone Go module preserves the former VesselOracle Cosmos SDK module
independently of the deleted intermediary application. It is dormant: no current
chain application imports it, no current async-ICQ host allowlists its queries,
and its Cardano Gateway controller is not registered.

The module retains the VesselOracle keeper, messages, queries, genesis state,
simulation support, CLI commands, tests, and canonical protobuf contract. Its
two Cardano-facing async-ICQ query paths are:

```text
/vesseloracle.vesseloracle.Query/ConsolidatedDataReport
/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport
```

## Integration

A Cosmos SDK 0.53 application can construct the keeper with
`keeper.NewKeeper`, construct the application module with
`module.NewAppModule`, and register that module and its store in the normal
Cosmos application lifecycle. The application must separately register the
standalone [`async-icq-v10`](../async-icq-v10/README.md) host on `icqhost` and
put the desired VesselOracle paths in its explicit query allowlist.

Those paths are exported as `types.QueryConsolidatedDataReportPath` and
`types.QueryLatestConsolidatedDataReportPath` so application wiring does not
need to duplicate protocol strings.

The original dependency-injection configuration belonged to the removed chain
application and is intentionally not retained. Authority selection and module
wiring are therefore explicit responsibilities of the integrating application.

The preserved Cardano Gateway adapter and inactive endpoints are documented in
[`docs/vesseloracle.md`](../../docs/vesseloracle.md).

## Maintenance

The canonical protobuf files live under `proto`. With `buf`,
`protoc-gen-gocosmos`, and `protoc-gen-grpc-gateway` installed, regenerate the
Go bindings with:

```sh
scripts/generate-proto.sh
```

The `proto-types` package consumes the same canonical files when generating the
TypeScript bindings used by the Gateway.

## Release Tags

Because this is a nested Go module, releases use directory-prefixed tags such
as:

```text
cosmos/vesseloracle-v10/v0.1.0
```
