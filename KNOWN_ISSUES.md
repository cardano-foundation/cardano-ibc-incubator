# Known Issues, Asymmetries, and Architectural Considerations

## Denom Trace Mapping Lives Off-Chain

Cosmos SDK chains store denom trace mappings in a consensus-state KVStore, but Cardano’s UTXO model lacks an equivalent on-chain key-value store. Voucher tokens embed the denom trace hash in their token names, which preserves authenticity, but the reverse lookup from hash to full trace must be maintained off-chain (for example in the Gateway’s database). The mapping is fully reconstructible by scanning voucher minting transactions, yet it relies on off-chain indexing for practical queries. We should continue to track this asymmetry and decide whether additional on-chain data or standardized rebuild tooling is needed for production readiness.
