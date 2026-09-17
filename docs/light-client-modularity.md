# Light-client registration and adapters

The Cardano IBC host keeps one shared HostState UTxO. Light-client modularity
changes which implementation validates a client; it does not partition the
host commitment or change ports, connections, or channels into separate hosts.

Tendermint remains the only production client implementation. Multiple client
instances use independent authentication tokens and state UTxOs. Creating a
client initializes one of those instances using the deployed scripts.

## On-chain boundary

`ics-002-client-semantics/registry.ak` defines immutable client registrations:

| Field | Authority |
| --- | --- |
| `client_type` | IBC identifier prefix |
| `implementation` | Compiled adapter used to interpret the datum |
| `mint_policy` | Policy authenticating the client instance |
| `spend_validator` | Script protecting client state transitions |
| `proof_policy` | Script verifying membership and non-membership proofs |

Deployment passes the same registrations to HostState, connection validators,
and channel operation validators. A relayer cannot supply or modify these
registrations. Adding an implementation requires rebuilding and deploying the
appropriate validator suite; this is not a runtime script installation API.

HostState selects the registered client output and authenticates its token and
spending script before committing its state. Connection and packet operations
resolve the full client identifier through the registry and authenticate the
corresponding token and script. Proof operations also bind the invoked proof
policy to that specific client, so another registered verifier cannot authorize
the operation.

The common `client_view.ak` interface carries opaque client and consensus
payloads, heights, status, timestamps, and processing metadata. It is an
in-memory view, not a new on-chain datum format. The Tendermint adapter owns
decoding, status calculation, and authenticated consensus-history hydration.
Tendermint minting, staged updates, recovery, and cryptographic proof verification
remain in its implementation. Core constructs the expected IBC paths and values
and binds the proof redeemer to the authenticated client payloads.

Existing byte-valued validator parameters retain the original Tendermint
binding for older callers of the script-construction helpers. Production
deployment uses explicit registrations, including the spending and proof
script hashes. Existing deployed scripts are immutable; source changes do not
upgrade a live deployment.

The Tendermint datum, public commitment values, and proof-redeemer encodings
remain unchanged. HostState retains its existing wire format and shared root.

## Gateway boundary

`ClientService` dispatches CreateClient, UpdateClient, and RecoverClient to
compiled handlers registered in `TxModule`. Creation dispatches on the protobuf
client-state type URL and requires a matching consensus-state type URL. Updates
dispatch on the full client ID and validate the message type. Recovery requires
both instances to belong to the same handler.

`TendermintClientService` owns the existing Tendermint transaction builders,
staged verification sessions, and recovery logic. Unknown types and mismatched
messages fail before they reach that implementation. Empty protobuf type URLs
are rejected at this boundary.

## Adding another client implementation

1. Implement its minting, update, recovery, and proof validators and its adapter
   to the common client view. Preserve authentication of historical checkpoints
   and the meaning of the processing metadata used for connection delays.
2. Add its implementation to the adapter dispatcher and register its identifier
   prefix and script hashes in the deployment graph. Registrations must have
   unambiguous prefixes, mint policies, and spending scripts.
3. Register its gateway transaction handler and provide the implementation's
   datum/protobuf codecs and query/indexing support. The shipped query and
   indexing codecs currently support Tendermint; a registration alone does not
   make an unimplemented client operational. Connection/channel proof arguments
   also retain their existing ICS-23 wire schema; an implementation with a
   different proof format must extend that boundary.
4. Exercise creation, updates, misbehaviour, recovery, history proofs, connection
   and channel handshakes, packet proofs, and ledger budgets for the new client.

Test-only registrations and mocked gateway handlers demonstrate independent
routing and rejection of mismatched authorities. They are not additional
production light clients.
