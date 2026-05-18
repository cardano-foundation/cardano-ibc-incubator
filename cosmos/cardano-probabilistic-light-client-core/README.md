# Cardano Probabilistic Light Client Core

This module contains shared Cardano/probabilistic verification logic used by the `ibc-go` versioned adapters:

```text
cosmos/cardano-probabilistic-light-client-v8
cosmos/cardano-probabilistic-light-client-v10
```

It intentionally does not register an IBC light client or import `ibc-go`. It owns reusable logic for Cardano block decoding, native verification payload construction, HostState datum extraction, and Cardano IBC commitment proof root calculation.

Release tags for this nested module must use the module directory prefix:

```text
cosmos/cardano-probabilistic-light-client-core/v0.1.0
```
