# Project Protocol Type Bindings

This workspace package generates the JavaScript and TypeScript protobuf
bindings used by the repository. It began from `cosmjs-types`, but is consumed
here as the local `proto-types` package and includes the project's vendored
Cosmos SDK, IBC, and Cardano protocol inputs.

## Install

```bash
npm install
```

The protobuf sources are already present under `protos/`; no Git submodule
initialization is required.

## Generate and Build

```bash
npm run codegen
npm run build
```

`scripts/codegen.js` reads the vendored protobuf inputs and regenerates
TypeScript under `src/`. The build command compiles the package into `build/`.
Generated source should be refreshed whenever an input protobuf changes.

The imported upstream release history is retained in [CHANGELOG.md](CHANGELOG.md)
for provenance.
