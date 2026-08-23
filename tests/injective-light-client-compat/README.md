# Injective light-client compatibility

This harness protects the HostState datum ABI already included by Injective. It imports the public probabilistic light-client core module path required by Injective's v8 integration, then replaces it with Injective's exact immutable `110e3155016b238c86fc86f58cbed544219b52d7` fork.

The fixture is generated and checked by the Gateway test. It deliberately contains an empty legacy integer port list and a non-empty textual port registry in the opaque fourth field. The Go test passes those exact bytes to the released decoder and checks the authenticated IBC root.

Run it with:

```sh
go test -C tests/injective-light-client-compat ./...
```
