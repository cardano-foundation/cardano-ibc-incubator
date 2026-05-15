# Preprod Manifests

This directory stores tracked bridge deployment artifacts for the shared Cardano preprod bridge.

- `cardano-preprod-handler.json`: full Cardano-side deployment artifact emitted by the offchain deployer
- `cardano-preprod-bridge-manifest.json`: public bridge manifest exported from the handler artifact
- `cardano-preprod-deployment-costs.json`: deployment transaction hashes, fees, and locked-ADA totals captured during the latest tracked preprod deployment

These files are intended to let other collaborators reuse the same Cardano preprod deployment without redeploying contracts.
