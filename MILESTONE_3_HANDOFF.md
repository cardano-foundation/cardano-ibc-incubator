# Cardano IBC Milestone 3 Handoff

## IBC Packet Flow Overview


As a brief overflow on packets and packet handlers, packets are the basic IBC data structure for information transmission. Each packet contains data like token transfer amounts and denominations, routing information (relevant to denom trace mapping), timeout constraints (specified by height or timestamp), and a sequence number for ordered delivery (all unordered channels in production however). We can talk further on ordered/unordered channels later but I think unordered is ideal here for now. The packet lifecycle is managed by handler functions that execute at different stages of the cross-chain communication process. The packet handlers implemented in this milestone process four key lifecycle events. 

The `sendPacket` handler escrows tokens on the source chain and emits a commitment to the packet data. 

The `recvPacket` handler verifies Merkle proofs against the counterparty client state and either mints voucher tokens or releases previously escrowed assets. 

The `acknowledgePacket` handler processes success or failure acknowledgments received from the destination chain. 

Lastly, the `timeoutPacket` handler refunds escrowed tokens when a packet expires without being delivered within its specified timeout window. 

The Gateway implements these handlers in `cardano/gateway/src/tx/packet.service.ts`, validating Merkle proofs against the IBC state root stored in the HostState datum. Denom trace mapping occurs during `recvPacket` when vouchers are minted, ensuring proper tracking of token origins across chains.

## Deliverables

### Gateway Transaction Handlers

The client creation handler in `cardano/gateway/src/tx/client.service.ts` (lines 50-127) builds unsigned CreateClient transactions that update the HostState datum by incrementing `next_client_sequence` and updating the `ibc_state_root` Merkle commitment. The handler mints a client authentication token using the `minting_client_stt` validator and registers a `create_client` event for consumption by the Hermes relayer. This event includes the newly assigned client ID, client type, and consensus height from the client's initial state. As discussed earlier, it is Hermes that actually does the transaction signature, so initially the gateway is just creating the data structure and then passing it off to Hermes. 

A significant compatibility fix for CBOR encoding is found in `cardano/gateway/src/shared/helpers/cbor-fix.ts`. Aiken-compiled Plutus validators expect definite-length CBOR arrays (encoded with specific length prefixes like `82` for 2 elements or `87` for 7 elements), but Lucid Evolution's default `Data.to()` function produces indefinite-length arrays (using `9f` start and `ff` end markers). The manual CBOR encoder in this module constructs properly formatted definite-length arrays to ensure compatibility between the TypeScript Gateway and on-chain Aiken validators. 

The submission service implements an event fallback mechanism in `cardano/gateway/src/tx/submission.service.ts` (lines 62-95) to handle cases where the event registration cache misses. When Hermes signs an unsigned transaction, the cryptographic hash changes, causing lookups keyed by the unsigned transaction hash to fail. The fallback queries Kupo for the current HostState UTXO, extracts the datum, and synthesizes a `create_client` event by inferring the client ID from `next_client_sequence - 1`. This ensures Hermes always receives the events it needs to track IBC entity creation, mirroring the behavior of Cosmos SDK chains.

### Relayer Integration

Transaction signing for Cardano occurs in `relayer/crates/relayer/src/chain/cardano/signer.rs`, which implements Conway-era CBOR support including proper handling of witness sets encoded with CBOR tag 258. The signer uses BIP32-Ed25519 key derivation via the `cryptoxide` crate (lines 1-180), which provides Cardano-specific cryptographic primitives that differ from standard Ed25519 implementations. This ensures compatibility with Cardano's hierarchical deterministic wallet scheme.

Event parsing logic in `relayer/crates/relayer/src/chain/cardano/event_parser.rs` (lines 31-464) converts Gateway events into Hermes IbcEvent types that the relayer can process uniformly across chains. The parser supports all IBC event types including `create_client`, `update_client`, connection handshake events (`connection_open_init`, `connection_open_try`, `connection_open_ack`, `connection_open_confirm`), channel handshake events, and packet lifecycle events (`send_packet`, `recv_packet`, `acknowledge_packet`, `timeout_packet`). This conversion layer abstracts away Cardano-specific event formats and presents a standard IBC interface to Hermes.

Key management is unified between the Gateway and Hermes through use of a shared `DEPLOYER_SK` bech32-encoded private key. This approach bypasses the mnemonic derivation path mismatch between Lucid Evolution (which uses non-hardened derivation indices `/0/0`) and the `ed25519-dalek-bip32` crate (which only supports fully hardened paths). The keyring implementation in `relayer/crates/relayer/src/chain/cardano/keyring.rs` (lines 174-195) loads the private key directly from the bech32 string, ensuring both systems control the same on-chain address and can interoperate seamlessly.

### Denom Trace Mapping

The denom trace implementation in `cardano/gateway/src/tx/packet.service.ts` (lines 617-634) handles token denomination tracking as tokens move across chains. During `recvPacket` processing, the handler extracts the denom trace (path and base denomination) from packet data, computes a hash over the concatenated path and base denom, and stores the mapping `hash(path+baseDenom) -> {path, baseDenom}` in PostgreSQL. The hash is embedded in the minted voucher token name, allowing on-chain validation of the denomination without storing the full trace path in the UTXO.

Recovery from database loss is provided by the backfill script in `cardano/gateway/src/scripts/backfill-denom-traces.ts`. This script reconstructs the denom traces table from historical on-chain data by scanning voucher minting transactions in db-sync, extracting packet data, re-computing hashes, and inserting the mappings into PostgreSQL. The off-chain database is reconstructible from canonical on-chain transaction history, preventing data loss even if the database is corrupted or deleted. I believe benchmarking what a reasonable reconstruction time would look like would be a valuable future initiative once the Hermes fork is complete.

### Integration Testing

The integration test suite in `caribic/src/test.rs` validates the complete IBC stack through five progressive tests. Tests 1-3 verify service health, query the HostState UTXO to confirm the `ibc_state_root` field exists, and create an IBC client on Cardano via Hermes. These tests currently pass successfully. Test 4 attempts connection creation but is blocked because the Cheqd testnet relayer account (`cheqd1r5v5srda7xfth3hn2s26txvrcrntldju4ftmuw`) does not exist on-chain yet and requires funding before the first transaction can be submitted. Test 5, which validates channel creation, is skipped due to the dependency on Test 4 completing successfully.

The CLI implementation in `caribic/src/main.rs` provides three primary commands for managing the bridge infrastructure. The `caribic start all` command launches the Cardano devnet, Gateway, Hermes relayer, and PostgreSQL database. The `caribic test` command runs the integration test suite and assumes all services are already running, providing clear error messages if any required service is unavailable. The `caribic health-check` command validates that all six required services (cardano-node, ogmios, kupo, gateway, postgres, relayer) are running and responding to health checks.

## Current Limitations

The implementation has documented three known technical issues in `KNOWN_ISSUES.md`. The PlutusData CBOR encoding incompatibility (lines 1-50) stems from Lucid Evolution's `Data.to()` producing indefinite-length CBOR arrays (`9f...ff` byte sequences) while Aiken validators expect definite-length arrays (specific length prefixes like `82` or `87`). The workaround involves manual CBOR construction in `cbor-fix.ts` to ensure on-chain validators can deserialize the data structures.

The key derivation mismatch (lines 51-100) arises from fundamental differences in hierarchical deterministic key derivation implementations. Lucid Evolution uses the Cardano Multiplatform Library (CML) with non-hardened derivation indices `/0/0`, while Hermes's `ed25519-dalek-bip32` crate only supports hardened derivation paths. The solution employs a shared `DEPLOYER_SK` bech32 private key that both systems load directly, bypassing mnemonic derivation entirely during testing.

Event cache misses (lines 101-150) occur because transaction hashes change when Hermes adds witness signatures to unsigned transactions. The Gateway's event registration cache keys events by the unsigned transaction hash, causing lookups to fail when Hermes submits the signed transaction with a different hash. The fallback mechanism synthesizes events from on-chain datum queries to ensure Hermes always receives the IBC events it requires for proper state tracking.

External dependencies require coordination with Cosmos chain operators. The Cardano light client must be explicitly whitelisted in the `allowed_clients` governance parameter on Cheqd and Osmosis networks (`README.md:159`), as these chains will reject client creation attempts for unregistered client types. Additionally, the Hermes relayer account on each Cosmos chain must be funded with tokens before it can submit its first transaction, as Cosmos SDK returns `NotFound` errors for accounts that have never received any tokens.

## Deployment Configuration

The validator deployment process in `cardano/offchain/src/deployment.ts` (lines 750-850) deploys six validators in sequence. The `mintHostStateNFT` validator is deployed first and immediately executed to mint the unique NFT that identifies the HostState UTXO. The `hostStateStt` spending validator is deployed with a parameter binding it to the NFT policy ID, ensuring it only accepts transactions that include the authentic HostState NFT. Three minting validators (`mintClientStt`, `mintConnectionStt`, `mintChannelStt`) are deployed to handle authentication token creation for IBC entities. The deployment script creates the initial HostState UTXO with version 1 and all sequence counters initialized to zero, establishing the genesis state for the IBC protocol.

The Gateway runs as a containerized NestJS application configured in `cardano/gateway/docker-compose.yml`. It exposes a gRPC interface on `127.0.0.1:5001` and depends on four supporting services: Ogmios (Cardano node interface), Kupo (UTXO indexer), PostgreSQL (denom trace storage), and db-sync (blockchain indexer for transaction history). The Gateway uses Lucid Evolution v0.4.29 for transaction construction and submission.

Hermes relayer configuration in `caribic/config/hermes-config.example.toml` specifies chain-specific parameters including the Gateway URL (`http://localhost:5001` for cardano-devnet) and client trusting periods. The Cardano devnet uses a 336-hour (14-day) trusting period, while the Cheqd testnet is configured with a 2-day trusting period that must remain shorter than the chain's 3-day unbonding period to prevent long-range attacks. This configuration is copied to `~/.hermes/config.toml` when `caribic start relayer` is executed.

## Files Modified and Created

The STT architecture required implementing six new Aiken validators in the `cardano/onchain/validators/` directory. These include `host_state_stt.ak` (main spending validator), `mint_host_state_nft.ak` (NFT minting), and three authentication token validators (`minting_client_stt.ak`, `minting_connection_stt.ak`, `minting_channel_stt.ak`).

Gateway modifications span eight files across the transaction and shared utility modules. The transaction handling layer (`cardano/gateway/src/tx/`) includes updates to `client.service.ts`, the new `submission.service.ts` for signed transaction processing, and `tx-events.service.ts` for event registration and retrieval. A new CBOR compatibility module (`cardano/gateway/src/shared/helpers/cbor-fix.ts`) provides definite-length encoding for Aiken validators. The shared types and services were updated in `client-datum.ts`, `lucid.service.ts`, and the dependency injection configuration in `tx.module.ts`.

Relayer changes touch five files primarily in the Cardano chain implementation. The `relayer/crates/relayer/src/chain/cardano/` directory contains updates to `keyring.rs` (bech32 key loading), `signer.rs` (Conway-era support), `endpoint.rs` (transaction submission flow), and the new `event_parser.rs` module for Gateway event conversion. Additionally, `relayer/crates/relayer/src/chain/cosmos/query/status.rs` was modified to fix chain ID revision number extraction.

Testing and CLI improvements are consolidated in three files within the `caribic/src/` directory: `test.rs` (integration test suite), `main.rs` (CLI command definitions and execution), and `start.rs` (service startup logic).

## Next Steps

Four immediate action items remain to complete the milestone. The Cheqd relayer account `cheqd1r5v5srda7xfth3hn2s26txvrcrntldju4ftmuw` requires funding to enable Test 4 completion, as Cosmos SDK chains return `NotFound` errors for unfunded accounts. Connection and channel event fallbacks should be implemented following the same pattern as the client creation fallback to handle cache misses for these entity types. A pull request should be submitted to the Lucid Evolution project to add or fix the canonical CBOR encoding option, eliminating the need for the manual workaround. Finally, integration tests 4 and 5 can be completed after the Cheqd account is funded and connection/channel fallbacks are implemented.
