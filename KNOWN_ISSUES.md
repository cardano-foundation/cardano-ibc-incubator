# Known Issues, Assymetries, and Architectural Considerations

## CBOR Encoding Incompatibility: Lucid Evolution vs Aiken Validators (2026-01-08) 🚨 CRITICAL

### Issue

**STATUS: BLOCKING** - Client creation transactions fail with Plutus script validation error due to a fundamental CBOR encoding incompatibility between Lucid Evolution and Aiken-compiled validators.

**Error**: `failed script execution Spend[0] failed to deserialise PlutusData using UnConstrData Value Con( Data( Array( Indef(`

**Root Cause**: Lucid Evolution encodes PlutusData using **indefinite-length CBOR arrays** (`0x9f...0xff`), while Aiken-compiled Plutus validators expect **definite-length arrays** (`0x82`, `0x87`, etc.). When Lucid builds transactions, it internally re-encodes datums attached to UTXOs, converting on-chain definite-length datums to indefinite-length format, which Aiken validators cannot deserialize.

### Technical Details

**CBOR Array Encoding:**
- **Definite-length**: `0x80+N` (e.g., `0x82` for 2 elements, `0x87` for 7 elements)
- **Indefinite-length**: `0x9f <items...> 0xff`

According to RFC 7049 (CBOR spec), **decoders MUST accept both formats**. However, Aiken's Plutus compilation or the underlying Plutus ledger validation appears to reject indefinite-length arrays when using `expect decoded_datum: T = datum` deserialization.

**What We Observed:**
1. ✅ Initial HostState UTXO created during deployment: definite-length CBOR (`d87982d87987...`)
2. ✅ On-chain datum verified via cardano-cli: `ScriptDataConstructor 0 [...]` (definite-length)
3. ✅ Manual CBOR encoder implemented for HostStateDatum: produces clean definite-length output
4. ❌ When Lucid's `collectFrom([hostStateUtxo], redeemer)` builds the transaction, it internally re-encodes the datum with indefinite arrays
5. ❌ Aiken validator fails to deserialize the re-encoded datum

**Evidence:**
```
# On-chain datum (definite-length, working):
d87982d87987 00 5820 0000...0000 00 00 00 80 1b0000019b9e97d94a 581c...
^Constructor 0, 2 elements  ^Constructor 0, 7 elements  ^integers  ^empty array  ^bigint

# Lucid re-encoded datum (indefinite-length, failing):
d8799f d8799f 00 5820 0000...0000 00 00 00 80 1b0000019b9e97d94a ff 581c... ff
      ^indefinite start                                               ^indefinite end
```

### Attempted Solutions

1. ✅ **Manual CBOR encoder**: Implemented `encodeHostStateDatumDefinite()` for creating new HostState datums with definite-length arrays
2. ✅ **Deployment script fix**: Updated `deployment.ts` to use manual CBOR encoding instead of Lucid's `Data.to()`
3. ❌ **Prevent Lucid re-encoding**: Attempted to preserve raw datum bytes in `collectFrom()`, but Lucid's internal transaction builder always re-encodes

### Impact

- **Severity**: 🚨 **CRITICAL/BLOCKING**
- **Affects**: All transactions that spend UTXOs with inline datums (HostState, Client, Connection, Channel)
- **Status**: Unable to create clients, connections, or channels until resolved

### Proposed Solutions

#### Option 1: Patch Lucid Evolution (SHORT-TERM)
Fork `@lucid-evolution/lucid` and patch the transaction builder to preserve raw datum CBOR:
- Modify `collectFrom()` to accept an option like `{ preserveRawDatums: true }`
- Update internal CBOR serialization to use definite-length arrays
- **Effort**: Medium (2-3 days)
- **Risk**: Maintenance burden when upstream updates

#### Option 2: Use Pallas for Transaction Building (MEDIUM-TERM)
Replace Lucid Evolution with Pallas (Rust library) for transaction construction:
- Already using Pallas in Hermes for transaction signing
- Full control over CBOR encoding
- Would require rewriting Gateway's transaction builder
- **Effort**: High (1-2 weeks)
- **Risk**: Large refactor, but more robust long-term solution

#### Option 3: Report to Aiken/Plutus Team (LONG-TERM)
File issue with Aiken to support indefinite-length CBOR arrays in `expect` deserialization:
- CBOR spec requires decoders to accept both formats
- Aiken should handle this per spec
- May be a Plutus ledger limitation, not Aiken
- **Effort**: Low (report issue)
- **Timeline**: Unknown, depends on Aiken team response

#### Option 4: Hybrid Approach (RECOMMENDED)
1. Implement **Option 1** immediately to unblock development
2. File **Option 3** for long-term fix
3. Evaluate **Option 2** if Lucid patch becomes unmaintainable

### Files Affected

- `cardano/gateway/src/shared/helpers/cbor-fix.ts`: Manual CBOR encoder for HostStateDatum
- `cardano/gateway/src/tx/client.service.ts`: Uses manual encoder for updated HostState datum
- `cardano/offchain/src/deployment.ts`: Uses manual CBOR encoding for initial deployment
- `cardano/gateway/src/shared/modules/lucid/lucid.service.ts`: Transaction builder (needs patching)

### Testing Performed

- ✅ Manual CBOR encoding produces clean definite-length output (verified with hex dump)
- ✅ On-chain initial HostState UTXO has definite-length datum (verified with cardano-cli)
- ✅ Gateway logs show updated HostState datum is definite-length
- ❌ Transaction still fails because Lucid re-encodes the old datum when spending

### References

- RFC 7049 (CBOR): https://datatracker.ietf.org/doc/html/rfc7049
- Lucid Evolution: https://github.com/Anastasia-Labs/lucid-evolution
- Aiken: https://github.com/aiken-lang/aiken
- Pallas: https://github.com/txpipe/pallas

---

## Cardano Key Derivation: Non-Hardened Path Requirement (2026-01-06)

### Issue

Hermes and Lucid Evolution initially derived different Cardano addresses from the same BIP39 mnemonic despite using the correct **BIP32-Ed25519** algorithm. The root cause was a **derivation path mismatch**:

- **Lucid Evolution** (via cardano-multiplatform-lib): Uses `m/1852'/1815'/0'/0/0` with the last two indices **non-hardened**
- **Standard BIP32-Ed25519 libraries**: Only support fully hardened paths like `m/1852'/1815'/0'/0'/0'`

This is not a bug in either implementation but a fundamental difference in Cardano's key derivation standards:
- **CIP-1852** (Cardano Improvement Proposal) specifies that payment credentials should use `m/1852'/1815'/account'/role/index` where `role` and `index` are **non-hardened** (0/0, not 0'/0')
- Most generic BIP32-Ed25519 libraries (like `ed25519-dalek-bip32`) only implement hardened derivation for Ed25519, as non-hardened derivation for Ed25519 requires special handling

### Technical Details

**Why Non-Hardened Derivation Matters:**
- Hardened derivation uses the private key in HMAC: `HMAC-SHA512(chain_code, 0x00 || privkey || index)`
- Non-hardened derivation uses the public key: `HMAC-SHA512(chain_code, 0x02 || pubkey || index)`
- Cardano wallets (Daedalus, Yoroi, Eternl, Lucid) all use non-hardened `/0/0` for the last two indices per CIP-1852
- If you derive with hardened `/0'/0'` instead, you get a completely different address

**Blake2b-224 vs Blake2b-512:**
- Cardano uses Blake2b with 28-byte output (Blake2b-224) for payment key hashes, not Blake2b-512 truncated
- Payment address = `0x60` (testnet) or `0x70` (mainnet) || Blake2b-224(verifying_key)

### Solution Implemented

For testing and development, we use **direct private key sharing** via bech32-encoded keys:

1. **Gateway**: Uses `DEPLOYER_SK` (ed25519_sk1...) from environment variables via Lucid Evolution's `fromPrivateKey()`
2. **Hermes**: Updated `CardanoKeyring::from_mnemonic()` to detect bech32 keys (starting with `ed25519_sk`) and decode them directly
3. **Keyring file**: Updated `~/.hermes/keys/cardano-devnet/keyring-test/cardano-relayer.json` to use the same `DEPLOYER_SK`

This approach:
- ✅ Ensures both Gateway and Hermes use identical keys
- ✅ Works with existing on-chain UTXOs owned by the deployer address
- ✅ Avoids the complexity of implementing Cardano-specific non-hardened BIP32-Ed25519 derivation
- ✅ Is appropriate for testing (though production should use hardware wallets or secure key management)

### Alternative Approach (Not Implemented)

We could implement full Cardano BIP32-Ed25519 with non-hardened support using IOHK's `cryptoxide` library, which provides the correct primitives for Cardano's derivation scheme. This would allow deriving from mnemonics with the exact path Lucid uses (`m/1852'/1815'/0'/0/0`). However, for testing purposes, sharing the bech32 private key is simpler and achieves the same result.

### Impact

- **Testing**: ✅ Resolved - Both Gateway and Hermes now use the same key
- **Production**: Minimal - Production deployments would use hardware wallets or secure keystores, not shared mnemonics
- **Security**: Private key sharing is acceptable for local devnet testing but should never be used in production

### Files Modified

- `relayer/crates/relayer/src/chain/cardano/keyring.rs`: Added `from_bech32_key()` to support loading bech32-encoded private keys
- `~/.hermes/keys/cardano-devnet/keyring-test/cardano-relayer.json`: Updated to use `DEPLOYER_SK` instead of test mnemonic
- `cardano/gateway/.env`: Already configured with `DEPLOYER_SK` for the deployer wallet

See `relayer/CARDANO_KEY_DERIVATION.md` for detailed technical analysis of the derivation path differences.

## Denom Trace Mapping Implementation Asymmetry

The IBC denom trace mapping feature exhibits an implementation asymmetry between account-based chains (Cosmos SDK) and UTXO-based chains (Cardano). In Cosmos SDK's reference implementation (ibc-go), denom traces are stored directly in the chain's KVStore as part of the transfer module's keeper, making them consensus-critical blockchain state accessible via standard query endpoints, whereas Cardano's UTXO model lacks a native equivalent to Cosmos's stateful modules with persistent key-value storage. As a result, while voucher tokens on Cardano embed the denom trace information as a hash in their token names (maintaining cryptographic integrity), the reverse lookup mapping—from hash back to the full path and base denomination—must be maintained separately in the Gateway's off-chain PostgreSQL database (or another agreed upon off-chain solution) rather than on-chain. This architectural difference does not compromise security or correctness, as the hash-based token naming ensures voucher authenticity, but it does create an implementation incongruency where denom trace queries rely on off-chain indexing infrastructure rather than direct chain state queries.

While it is technically possible to store denom trace mappings on-chain within UTXO datums, that approach introduces challenges that make it suboptimal compared to off-chain indexing. Each UTXO on Cardano requires a minimum ADA deposit proportional to its size, meaning a growing mapping table would lock increasing amounts of capital as more cross-chain tokens are bridged. Additionally, Cardano's UTXO model lacks native indexed key-value lookups—querying a specific denom trace would require either scanning multiple UTXOs or maintaining a complex reference system, neither of which matches the instant lookup performance of Cosmos's KVStore. Furthermore, updating the mapping would require consuming and recreating UTXOs with validator logic, adding transaction costs and complexity for what is essentially read-heavy reference data. Since denom traces are derivable from transaction history and do not affect the security of token transfers (the on-chain voucher hashes remain authoritative), the cost-benefit analysis strongly favors off-chain indexing over on-chain UTXO storage.

Importantly, the off-chain denom trace database is fully reconstructible from on-chain data, as voucher minting transactions contain all necessary information to derive the hash-to-trace mappings. The reconstruction process works as follows: each voucher minting transaction includes a RecvPacket redeemer that contains the full fungible token packet data with the original denom string (e.g., "transfer/channel-0/uatom"), and the transaction simultaneously mints a voucher token whose name is the sha3_256 hash of the prefixed denom. By scanning historical transactions that interact with the voucher minting policy, one can extract the packet data to recover the full path and base denomination, then compute the hash to create the reverse lookup mapping. This process is deterministic and yields identical results regardless of who performs the scan, as both the packet data and the hash function are publicly observable on-chain. In scenarios where multiple bridge operators maintain separate infrastructure with independent databases, each operator would derive identical denom trace mappings because the hash computation is deterministic (based on the voucher token name observed on-chain). Similarly, if a bridge's database is lost, corrupted, or deleted, it can be rebuilt by scanning historical Cardano transactions for voucher minting events and extracting the packet data that contains the full denom path. While temporary database unavailability would interrupt query service for denom trace lookups, it would not affect the correctness or security of token transfers themselves, as the authoritative source of truth remains the on-chain voucher token hashes. Bridge operators might implement backup strategies, or providing synchronization mechanisms to ensure query availability and reduce redundant indexing work across multiple deployments.
