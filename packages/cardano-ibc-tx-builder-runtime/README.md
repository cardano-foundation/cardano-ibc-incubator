# Cardano IBC transaction-builder runtime

Packet leaves are authoritative in `HostState.ibc_state_root`; they are not recoverable from `ChannelDatum`. A standalone runtime must therefore configure a trusted, writable `ibcTreeRecoveryStore`: every unsigned packet transaction is rejected unless its exact old-root/new-root mutation journal is durably prepared before the transaction is returned. `ibcTreeRecoveryUrl` is read-only and can bootstrap a tree, but it does not make transaction construction durable by itself.

Signed packet transactions must be submitted through the same confirming service that owns the writable store. `ibcSubmitUrl` can target that service; direct Ogmios submission is intentionally rejected because it could advance the on-chain root without preserving the off-chain leaves needed after restart.

The standard Gateway exposes read-only recovery at `/api/ibc/tree-recovery` and confirmed submission at `/api/cardano/submit`, but it deliberately does not expose an unauthenticated journal-write endpoint. In-repository applications should build with Gateway `/api/transfer`; an independent builder needs its own authenticated persistence adapter.
