# Preprod deployment artifacts

No Preprod deployment artifacts are bundled. The obsolete deployment manifest, handler and cost report have been removed. The repository's current shared deployment is on [Preview](../preview/cardano-preview-bridge-manifest.json).

Caribic retains this directory as the default output location for a fresh Preprod deployment. To join an existing Preprod bridge, configure the Preprod profile's `bridge_manifest_path` with a trusted, compatible manifest containing the required history-bootstrap metadata.
