# Identify UTXOs of IBC Cardano

Cardano IBC stores protocol state in the datums of multiple UTXOs. Anyone can
send an output with arbitrary data to a script address, so an address alone does
not authenticate protocol state. Validators instead require authentication tokens
minted under the deployment's policies and retained by valid state transitions.

## HostState identity token

The canonical coordinator is the `HostState` single token thread (STT). Its UTXO
contains the IBC commitment root, object sequences, and bound-port registrations.
The [HostState NFT policy](../onchain/validators/host_state_nft.ak) is parameterized
by an output reference. `MintInitial` requires that output to be consumed and
mints exactly one token named `ibc_host_state`; the same output cannot be consumed
again, so that policy cannot mint a second initial NFT.

Using `||` for byte concatenation:

```text
host_state_token_unit = host_state_nft_policy_id || utf8("ibc_host_state")
```

The [HostState spending validator](../onchain/validators/host_state_stt.ak)
authenticates state transitions and preserves the NFT in the successor HostState
UTXO during normal operation. Final shutdown uses `FinalizeShutdown` together
with the NFT policy's `BurnFinal` redeemer to destroy the singleton.

## Client, connection, and channel identity tokens

These entities use the HostState NFT as the base (referrer) token passed to
[`auth.generate_token_name`](../onchain/lib/ibc/auth.ak). Each entity has its own
minting policy; the shared base in its token name binds it to the same HostState
instance.

The formulas below operate on raw bytes. Slices `[0:n]` take the first `n` bytes,
and `decimal(sequence)` is the decimal string representation of the sequence.

```text
base = sha3_256(host_state_token_unit)[0:20]
client_token_name = base || sha3_256(utf8("ibc_client"))[0:4] || utf8(decimal(client_sequence))
connection_token_name = base || sha3_256(utf8("connection"))[0:4] || utf8(decimal(connection_sequence))
channel_token_name = base || sha3_256(utf8("channel"))[0:4] || utf8(decimal(channel_sequence))
entity_token_unit = entity_minting_policy_id || entity_token_name
```

The sequence suffix is limited to eight bytes, keeping the token name within
Cardano's 32-byte asset-name limit. The client, connection, and channel minting
policies validate creation against the corresponding HostState transition.

## Port identity tokens

Port token names use the complete, case-sensitive IBC port identifier:

```text
port_token_name = blake2b_256(utf8("cardano-ibc/port-token/v1") || 0x00 || utf8(port_id))
port_token_unit = port_minting_policy_id || port_token_name
```

The [port minting policy](../onchain/validators/minting_port.ak) is parameterized
by the HostState identity, so its policy ID associates every port token with a
specific HostState instance. The domain-separated digest keeps arbitrary valid
textual port IDs within the asset-name limit. Off-chain services can query these
tokens to locate protocol UTXOs, while validators authenticate their tokens,
datums, and relationships to other protocol state.
