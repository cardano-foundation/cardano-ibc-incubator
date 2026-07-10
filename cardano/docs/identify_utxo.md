# Identifying Cardano IBC UTxOs

Cardano's eUTXO model stores application state in transaction outputs. An
address alone cannot identify authentic bridge state because anyone can send an
output with arbitrary data to a script address. Cardano IBC therefore attaches
native authentication tokens to its state UTxOs and validates those tokens in
the corresponding minting and spending scripts.

## Canonical HostState NFT

The canonical HostState UTxO is identified by the NFT minted by
[`host_state_nft.ak`](../onchain/validators/host_state_nft.ak). The minting
policy is parameterized by an output reference and requires that output to be
consumed, making the mint a one-time operation. It mints exactly one token with
the fixed name defined in
[`host_state.ak`](../onchain/lib/ibc/core/ics-025-handler-interface/host_state.ak):

```text
host_state_token_unit = host_state_nft_policy_id + to_bytes("ibc_host_state")
```

The NFT remains with the single canonical HostState UTxO as that state is
updated. This provides continuity and an unambiguous indexing key.

## Other IBC State Tokens

Clients, connections, channels, and ports use sequence-derived token names.
The base portion comes from the HostState token unit, followed by a four-byte
hash prefix for the entity type and the UTF-8 bytes of its decimal sequence:

```text
base = sha3_256(host_state_token_unit)[0:20]

client_token     = base + sha3_256(to_bytes("ibc_client"))[0:4] + to_bytes(sequence.toString())
connection_token = base + sha3_256(to_bytes("connection"))[0:4] + to_bytes(sequence.toString())
channel_token    = base + sha3_256(to_bytes("channel"))[0:4] + to_bytes(sequence.toString())
port_token       = base + sha3_256(to_bytes("port"))[0:4] + to_bytes(sequence.toString())
```

The implementation is in
[`auth.ak`](../onchain/lib/ibc/auth.ak). These tokens let validators and
off-chain services authenticate, cross-reference, and query distributed IBC
state without trusting an address lookup by itself.
