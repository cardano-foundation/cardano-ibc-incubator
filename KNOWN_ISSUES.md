# Known Issues, Asymmetries, and Architectural Considerations

## Cardano Key Derivation: Non-Hardened Path Requirement

Hermes and Lucid Evolution initially derived different Cardano addresses from the same BIP39 mnemonic despite using the correct BIP32-Ed25519 algorithm. The root cause was a derivation path mismatch:

- Lucid Evolution (via cardano-multiplatform-lib): Uses `m/1852'/1815'/0'/0/0` with the last two indices non-hardened
- Standard BIP32-Ed25519 libraries: Only support fully hardened paths like `m/1852'/1815'/0'/0'/0'`

This is not a bug in either implementation but a fundamental difference in Cardano's key derivation standards. CIP-1852 specifies that payment credentials should use `m/1852'/1815'/account'/role/index` where `role` and `index` are non-hardened (0/0, not 0'/0'). Most generic BIP32-Ed25519 libraries only implement hardened derivation for Ed25519, as non-hardened derivation requires special handling.

For testing and development, we use direct private key sharing via bech32-encoded keys (`DEPLOYER_SK`). Both Gateway and Hermes load the same `ed25519_sk1...` key directly, avoiding the complexity of implementing Cardano-specific non-hardened BIP32-Ed25519 derivation.

## Denom Trace Mapping Lives Off-Chain

Cosmos SDK chains store denom trace mappings in a consensus-state KVStore, but Cardano's UTXO model lacks an equivalent on-chain key-value store. Voucher tokens embed the denom trace hash in their token names, which preserves authenticity, but the reverse lookup from hash to full trace must be maintained off-chain (in the Gateway's PostgreSQL database).

The mapping is fully reconstructible from on-chain data: each voucher minting transaction includes a RecvPacket redeemer containing the full fungible token packet data with the original denom string, and the transaction simultaneously mints a voucher token whose name is the sha3_256 hash of the prefixed denom. By scanning historical transactions that interact with the voucher minting policy, the hash-to-trace mappings can be deterministically rebuilt.

This architectural difference does not compromise security or correctness, as the hash-based token naming ensures voucher authenticity, but it does create an implementation asymmetry where denom trace queries rely on off-chain indexing infrastructure rather than direct chain state queries.
