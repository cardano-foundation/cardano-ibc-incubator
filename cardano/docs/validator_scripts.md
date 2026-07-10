# Cardano Validator Scripts

The Cardano IBC on-chain logic is written in
[Aiken](https://aiken-lang.org/) and lives in
[`cardano/onchain/validators/`](../onchain/validators/). The validators enforce
IBC state transitions in Cardano's eUTXO model.

## Validator Groups

The current validator set includes:

- **Host state:** `host_state_nft.ak` identifies the canonical HostState UTxO,
  while `host_state_stt.ak` enforces its state-thread continuity and lifecycle.
- **IBC core state:** minting and spending validators for clients,
  connections, channels, and ports.
- **Packet handling:** the validators under `spending_channel/` implement send,
  receive, acknowledgement, timeout, and channel-handshake transitions.
- **Proof verification:** `verifying_proof.ak` checks commitment proofs used by
  connection, channel, and packet operations.
- **Token transfer:** `spending_transfer_module.ak` and `minting_voucher.ak`
  implement the transfer module and voucher lifecycle.
- **Denom trace registry:** `trace_registry.ak` and its supporting minting
  policy keep denomination trace mappings on-chain.
- **Escrow sharding:** `minting_transfer_escrow_shard.ak` identifies transfer
  escrow shards used to reduce contention.
- **Voucher metadata:** `voucher_metadata.ak` validates voucher metadata state.

The validator filenames are the maintained inventory; tests live alongside the
corresponding scripts.

## State Authentication

IBC state is distributed across multiple UTxOs because Cardano transactions and
outputs have bounded sizes. Native authentication tokens distinguish canonical
bridge state from arbitrary outputs at the same script address. Spending
validators require the expected token to continue into the updated output, and
minting policies control token creation.

See [Identifying Cardano IBC UTxOs](identify_utxo.md) for the HostState NFT and
sequence-derived entity token scheme.

## Reference Scripts

Cardano IBC uses [CIP-33 reference scripts](https://cips.cardano.org/cip/CIP-0033)
so transactions can reference deployed validator bytecode instead of carrying
every script inline. This is necessary for larger bridge transitions to remain
within transaction-size limits.

Some operations are split across a spending validator and transaction-level
minting policies. The spending validator verifies that the required policy is
executed, while the policy validates the operation-specific transition. Script
hashes are supplied as parameters where validators need to authenticate one
another.

## Deployment

"Deployment" creates the canonical HostState, module state, authentication
tokens, and reference-script UTxOs. The maintained implementation is
[`cardano/offchain/src/deployment.ts`](../offchain/src/deployment.ts). It reads
the compiled Aiken blueprint, initializes parameterized scripts in dependency
order, submits the required transactions, and writes deployment artifacts under
`cardano/offchain/deployments/`, including `handler.json`.

The Gateway can also consume or expose a public bridge manifest derived from
that deployment. See the [Gateway bridge manifest documentation](../gateway/README.md#bridge-discovery-manifest).
