# Preprod Manifests

This directory stores tracked bridge deployment artifacts for the shared Cardano preprod bridge.

- `cardano-preprod-handler.json`: full Cardano-side deployment artifact emitted by the offchain deployer
- `cardano-preprod-bridge-manifest.json`: public bridge manifest exported from the handler artifact

These files are intended to let other collaborators reuse the same Cardano preprod deployment without redeploying contracts.
