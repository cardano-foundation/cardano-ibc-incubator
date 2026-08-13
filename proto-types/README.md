# @cardano-ibc/proto-types

Protocol Buffer definitions and generated bindings used by Cardano IBC
components. The TypeScript package is consumed as `@cardano-ibc/proto-types`.

## Layout

- `protos/ibc-go/` contains the source Protocol Buffer definitions.
- `src/` contains generated TypeScript sources and is committed to the repository.
- `build/` is the local TypeScript build output and is not committed.
- `go/` contains the currently generated Go bindings.
- `scripts/` contains the generation and packaging helpers.

## Maintenance

From this directory, install the locked dependencies and regenerate the
TypeScript bindings:

```sh
npm ci
npm run codegen
npm run build
```

Commit generated changes in `src/` together with the Protocol Buffer source
change that produced them. Repository CI verifies that checked-in generated
artifacts are current.

## Provenance

This package originated as a repository-local adaptation of
[`cosmjs-types`](https://github.com/confio/cosmjs-types). Its historical
changelog, upstream contributor attribution, and Apache-2.0 license are retained.
