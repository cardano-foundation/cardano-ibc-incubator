# Known Issues, Asymmetries, and Architectural Considerations

## CBOR Encoding Expectations between Lucid Evolution and Aiken Validators

Cardano transactions built with Lucid Evolution re-encode inline datums during transaction construction, and the library defaults to indefinite-length CBOR arrays. The Aiken-compiled Plutus validators used in this project expect definite-length arrays when deserializing datums and redeemers. This mismatch can surface as `failed to deserialise PlutusData using UnConstrData` when spending UTXOs whose datums were originally encoded with definite lengths. The current mitigation is to use manual, definite-length CBOR encoders for datums we produce. Long term we need either upstream support in Lucid for preserving definite-length encodings or a change in the validators to accept both forms per the CBOR specification.

## Denom Trace Mapping Lives Off-Chain

Cosmos SDK chains store denom trace mappings in a consensus-state KVStore, but Cardano’s UTXO model lacks an equivalent on-chain key-value store. Voucher tokens embed the denom trace hash in their token names, which preserves authenticity, but the reverse lookup from hash to full trace must be maintained off-chain (for example in the Gateway’s database). The mapping is fully reconstructible by scanning voucher minting transactions, yet it relies on off-chain indexing for practical queries. We should continue to track this asymmetry and decide whether additional on-chain data or standardized rebuild tooling is needed for production readiness.
