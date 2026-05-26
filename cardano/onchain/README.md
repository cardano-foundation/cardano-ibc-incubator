# Cardano IBC On-chain Protocol

This package contains the Aiken validators that make Cardano act as an IBC host
chain. It maps the account-based IBC model onto Cardano's eUTXO model by using
state-thread tokens, validator-checked datum transitions, and a single HostState
commitment root that counterparties can verify.

The goal of this document is to give contributors a visual map of how the
on-chain protocol works. For exhaustive security claims and test labels, read
[`../../INVARIANTS.md`](../../INVARIANTS.md). For voucher reverse lookup details,
read [`../../docs/cardano-trace-registry.md`](../../docs/cardano-trace-registry.md).

For a formal validator-level model, read
[`docs/protocol-state-machine`](docs/protocol-state-machine). It represents
every on-chain validator as a state-machine participant and maps protocol
mechanisms to transitions, guards, effects, and durable writes.

## Mental Model

IBC expects a host chain to maintain clients, connections, channels, packet
commitments, receipts, acknowledgements, ports, and application callbacks. On
Cardano, those are distributed across UTxOs. Each canonical UTxO is authenticated
by a non-fungible token minted by protocol-controlled policies.

```mermaid
flowchart TB
  subgraph "Counterparty-facing IBC state"
    Host["HostState UTxO<br/>single IBC commitment root"]
    Client["Client UTxOs<br/>client state and consensus states"]
    Conn["Connection UTxOs<br/>connection ends"]
    Chan["Channel UTxOs<br/>channel ends and packet maps"]
    Port["Port and module UTxOs<br/>application binding"]
  end

  subgraph "Cardano-local transfer state"
    Transfer["Transfer module UTxO"]
    Escrow["Escrow shard UTxOs"]
    Voucher["Voucher minting policy"]
    Registry["Trace-registry directory and shards"]
  end

  Host -->|"commits ICS-24 keys"| Client
  Host -->|"commits ICS-24 keys"| Conn
  Host -->|"commits ICS-24 keys"| Chan
  Host -->|"commits port paths"| Port
  Chan -->|"calls module callbacks"| Transfer
  Transfer -->|"native source-chain accounting"| Escrow
  Transfer -->|"sink-chain accounting"| Voucher
  Voucher -->|"first-seen trace witness"| Registry
```

The protocol has three recurring patterns:

- **Thread tokens identify canonical state.** A script address alone is not
  enough because anyone can send arbitrary UTxOs to a script address.
- **HostState commits cross-chain state.** Client, connection, channel, packet,
  and port changes must update the HostState commitment root in the same
  transaction.
- **Marker mints bind multi-validator transactions.** Operation-specific minting
  policies make sure the channel spend, HostState spend, proof check, and module
  accounting all refer to the same operation.

## Directory Map

```mermaid
flowchart LR
  A["lib/ibc"] --> B["IBC types and transition helpers"]
  A --> C["Tendermint light-client logic"]
  A --> D["ICS-23 proof helpers"]
  A --> E["transfer app helpers"]
  A --> F["test and fuzz DSL"]

  G["validators"] --> H["HostState"]
  G --> I["client, connection, channel state"]
  G --> J["operation marker minting policies"]
  G --> K["transfer, voucher, trace registry"]
  G --> L["proof verifier"]
```

Key entry points:

| Area | Files |
| --- | --- |
| Host coordinator | [`validators/host_state_stt.ak`](validators/host_state_stt.ak), `lib/ibc/core/ics-025-handler-interface/host_state.ak` |
| Auth tokens | [`lib/ibc/auth.ak`](lib/ibc/auth.ak) |
| Client updates | [`validators/spending_client.ak`](validators/spending_client.ak), `lib/ibc/client/ics-007-tendermint-client/*` |
| Connection state | [`validators/spending_connection.ak`](validators/spending_connection.ak), `lib/ibc/core/ics-003-connection-semantics/*` |
| Channel and packets | [`validators/spending_channel.ak`](validators/spending_channel.ak), [`validators/spending_channel/`](validators/spending_channel/) |
| Transfer app | [`validators/spending_transfer_module.ak`](validators/spending_transfer_module.ak), `lib/ibc/apps/transfer/*` |
| Voucher assets | [`validators/minting_voucher.ak`](validators/minting_voucher.ak), [`validators/voucher_metadata.ak`](validators/voucher_metadata.ak) |
| Trace registry | [`validators/trace_registry.ak`](validators/trace_registry.ak) |
| Proof verification | [`validators/verifying_proof.ak`](validators/verifying_proof.ak) |

## State UTxO Anatomy

Most canonical state UTxOs look like this:

```mermaid
flowchart LR
  TxIn["Input UTxO"] --> Addr["Validator address"]
  TxIn --> Token["State-thread NFT<br/>policy id + token name"]
  TxIn --> Datum["Inline datum<br/>typed protocol state"]

  Token --> Auth["AuthToken"]
  Auth --> Locate["Used to locate the canonical UTxO"]
  Auth --> Continue["Required on the continuation output"]
  Datum --> Transition["Validator checks allowed transition"]
```

The state-thread NFT is the identity. The datum is the mutable state. A valid
transition spends exactly the old state UTxO and creates the matching
continuation output with the same auth token and the updated datum.

## Auth Token Derivation

The HostState NFT is the root identity. Other state tokens are derived from that
root token, a domain prefix, and a sequence number.

```mermaid
flowchart TD
  H["HostState NFT<br/>policy id + token name"] --> Hash["sha3_256(host token unit)<br/>take first 20 bytes"]
  Prefix["domain prefix<br/>ibc_client, connection, channel, port"] --> PrefixHash["sha3_256(prefix)<br/>take first 4 bytes"]
  Seq["sequence bytes<br/>client, connection, channel, or port number"] --> Name["token name"]
  Hash --> Name
  PrefixHash --> Name
  Name --> Token["derived state-thread NFT"]

  Token --> Client["client token"]
  Token --> Conn["connection token"]
  Token --> Chan["channel token"]
  Token --> Port["port token"]
```

This lets validators prove that a client, connection, channel, or port belongs
to the same HostState instance without trusting script addresses alone.

## HostState Commitment Root

HostState is the only state thread that counterparties conceptually care about.
It contains the IBC commitment root and sequence counters. Transactions that
change IBC state must also prove the corresponding root update.

```mermaid
flowchart TB
  Old["Old HostState datum<br/>ibc_state_root = R0"] --> Redeemer["HostState redeemer"]
  Redeemer --> Branch{"Operation branch"}
  Branch --> CreateClient["CreateClient"]
  Branch --> UpdateClient["UpdateClient"]
  Branch --> CreateConn["CreateConnection"]
  Branch --> UpdateConn["UpdateConnection"]
  Branch --> CreateChan["CreateChannel"]
  Branch --> UpdateChan["UpdateChannel"]
  Branch --> Packet["HandlePacket"]
  Branch --> Port["BindPort"]

  CreateClient --> Keys["Compute exact ICS-24 key/value updates"]
  UpdateClient --> Keys
  CreateConn --> Keys
  UpdateConn --> Keys
  CreateChan --> Keys
  UpdateChan --> Keys
  Packet --> Keys
  Port --> Keys

  Keys --> Apply["Apply Merkle update witnesses"]
  Apply --> New["New HostState datum<br/>ibc_state_root = R1"]
```

The HostState validator does not just check that the root changed. It derives
the exact keys and values from the state UTxOs in the transaction, applies the
provided sibling witnesses, and requires the output root to match.

## Validator Coupling Pattern

Most protocol operations are not single-validator events. They are composed
transactions where multiple scripts must agree on the same logical operation.

```mermaid
flowchart LR
  HostSpend["Spend HostState<br/>root branch"]
  StateSpend["Spend client, connection,<br/>or channel UTxO"]
  MarkerMint["Mint operation marker"]
  ProofMint["Mint proof marker<br/>when remote proof is needed"]
  ModuleSpend["Spend app module<br/>when channel callback is needed"]

  HostSpend <-->|"same transaction"| StateSpend
  StateSpend <-->|"auth token in redeemer"| MarkerMint
  ProofMint -.->|"proof operations"| StateSpend
  ModuleSpend -.->|"callbacks and accounting"| StateSpend
```

Examples:

- `spend_client` requires a matching HostState `UpdateClient` redeemer.
- `spend_connection` requires HostState `UpdateConnection` and proof-marker
  validation for proof-bearing handshake steps.
- `spend_channel` requires HostState `UpdateChannel` or `HandlePacket` plus the
  exact operation marker mint.
- `spend_transfer_module` requires the HostState thread and validates transfer
  module accounting against the channel packet callback.

## Client Updates

Client state tracks the counterparty chain. Updates verify a Tendermint header
or detect misbehaviour, update the client datum, and commit the result into the
HostState root.

```mermaid
sequenceDiagram
  participant Relayer
  participant Client as Client UTxO
  participant Host as HostState UTxO
  participant LC as Tendermint client logic

  Relayer->>Client: spend with UpdateClient message
  Client->>Host: require HostState UpdateClient in same tx
  Client->>LC: verify header against stored consensus states
  alt valid update
    Client->>Client: advance latest height and insert consensus state
    Host->>Host: commit client state and consensus state updates
  else misbehaviour
    Client->>Client: freeze client
    Host->>Host: commit frozen client state
  end
```

Important checks:

- The input carries the client auth token.
- The continuation output keeps only the same client auth token.
- The client is active before normal updates.
- The transaction validity interval is converted to nanoseconds for client-time
  checks.
- Added and removed consensus states are mirrored in the HostState root.

## Connection Handshake

Connections follow the IBC state machine while adapting proof verification to
Cardano minting policies and reference inputs.

```mermaid
stateDiagram-v2
  [*] --> Uninitialized
  Uninitialized --> Init: ConnOpenInit
  Uninitialized --> TryOpen: ConnOpenTry
  Init --> Open: ConnOpenAck
  TryOpen --> Open: ConnOpenConfirm
  Open --> [*]
```

```mermaid
sequenceDiagram
  participant Tx as Cardano transaction
  participant Conn as Connection UTxO
  participant Client as Client reference input
  participant Proof as Verify-proof mint
  participant Host as HostState UTxO

  Tx->>Conn: spend connection state
  Tx->>Client: reference client state and consensus state
  Tx->>Proof: verify counterparty connection proof
  Tx->>Host: update committed connection key
  Conn->>Conn: write updated connection datum
```

The connection validator verifies that:

- the connection UTxO carries its auth token;
- the client referenced by the connection is active;
- proof-bearing steps include the expected verify-proof redeemer;
- the datum transition matches the IBC handshake rules;
- HostState commits the connection state update.

## Channel Handshake And Close

Channel state is stored in a channel UTxO and committed through HostState. The
channel validator also enforces operation marker mints so the spend cannot be
reused as an unrelated channel transition.

```mermaid
stateDiagram-v2
  [*] --> Init: ChanOpenInit
  [*] --> TryOpen: ChanOpenTry
  Init --> Open: ChanOpenAck
  TryOpen --> Open: ChanOpenConfirm
  Open --> Closed: ChanCloseInit
  Open --> Closed: ChanCloseConfirm
```

```mermaid
flowchart TB
  Spend["spend_channel"] --> Branch{"Redeemer"}
  Branch --> OpenAck["ChanOpenAck"]
  Branch --> OpenConfirm["ChanOpenConfirm"]
  Branch --> CloseInit["ChanCloseInit"]
  Branch --> CloseConfirm["ChanCloseConfirm"]
  Branch --> Send["SendPacket"]
  Branch --> Recv["RecvPacket"]
  Branch --> Ack["AcknowledgePacket"]
  Branch --> Timeout["TimeoutPacket"]

  OpenAck --> UpdateChan["HostState UpdateChannel"]
  OpenConfirm --> UpdateChan
  CloseInit --> UpdateChan
  CloseConfirm --> UpdateChan
  Send --> HandlePacket["HostState HandlePacket"]
  Recv --> HandlePacket
  Ack --> HandlePacket
  Timeout --> HandlePacket

  UpdateChan --> Marker["exact marker mint for operation"]
  HandlePacket --> Marker
  Marker --> Continuation["validate channel continuation output"]
```

## Packet Lifecycle

Packet state lives inside the channel datum and in the HostState commitment
root. Packet operations are coupled to transfer module callbacks when the
channel belongs to the transfer application.

```mermaid
flowchart LR
  Open["Open channel"] --> Send["SendPacket<br/>insert packet commitment<br/>increment next_sequence_send"]
  Send --> Relay1["Relayer carries packet"]
  Relay1 --> Recv["RecvPacket<br/>record receipt<br/>write ack commitment"]
  Recv --> Relay2["Relayer carries acknowledgement"]
  Relay2 --> Ack["AcknowledgePacket<br/>remove packet commitment"]

  Send --> Timeout["TimeoutPacket<br/>remove packet commitment"]
  Timeout --> OpenOrClosed{"Ordering"}
  OpenOrClosed -->|"unordered"| Open
  OpenOrClosed -->|"ordered"| Closed["Closed channel"]
```

```mermaid
sequenceDiagram
  participant Channel
  participant Host
  participant Module as Transfer module
  participant Marker as Packet marker policy

  Channel->>Host: require HandlePacket branch
  Channel->>Marker: require exact marker mint
  Channel->>Module: pass IBC module callback
  Module->>Module: validate app-level accounting
  Host->>Host: commit packet key update
  Channel->>Channel: write channel continuation datum
```

The packet validators enforce:

- send sequence matches `next_sequence_send`;
- packet commitments, receipts, and acknowledgements are updated consistently;
- timeout cannot execute before the timeout timestamp;
- ordered timeout closes the channel;
- application callbacks refer to the same packet bytes as the channel redeemer.

## Transfer Accounting

ICS-20 transfer accounting depends on whether Cardano is the source chain for
the packet denom.

```mermaid
flowchart TD
  Packet["FungibleTokenPacketData"] --> Source{"Is Cardano source chain<br/>for this denom?"}

  Source -->|"yes, outbound send"| Escrow["Escrow native asset<br/>in transfer escrow shard"]
  Source -->|"yes, inbound receive or refund"| Unescrow["Unescrow native asset<br/>to receiver or sender"]

  Source -->|"no, outbound send"| Burn["Burn voucher amount"]
  Source -->|"no, inbound receive or refund"| Mint["Mint voucher amount"]

  Escrow --> Shard["Escrow shard datum<br/>channel id + denom"]
  Unescrow --> Shard
  Mint --> Registry["First-seen voucher trace registry witness"]
```

The transfer module validator is the bridge between channel callbacks and asset
accounting. It validates callback shape, channel identity, and exact value
deltas on module state or escrow shard UTxOs.

```mermaid
flowchart LR
  ChannelCallback["Channel callback<br/>OnRecv, OnAck, OnTimeout"] --> Transfer["spend_transfer_module"]
  Operator["Operator send tx"] --> Transfer
  Transfer --> Native["native source-chain path<br/>escrow or unescrow"]
  Transfer --> Voucher["voucher sink-chain path<br/>mint, burn, or refund"]
  Native --> EscrowShard["transfer escrow shard NFT"]
  Voucher --> VoucherPolicy["mint_voucher policy"]
```

## Voucher Minting And Metadata

Cardano voucher token names are compact hashes of full ICS-20 denom traces. The
minting policy ties each mint or burn to a channel packet operation.

```mermaid
flowchart TD
  FullDenom["full denom trace<br/>transfer/channel-n/base"] --> Hash["sha3_256(full denom)"]
  Hash --> UserToken["CIP-67 user token name"]
  Hash --> RefToken["CIP-67 reference NFT token name"]
  Packet["RecvPacket, TimeoutPacket,<br/>or AcknowledgePacket error"] --> Policy["mint_voucher policy"]
  Policy --> UserToken
  Policy --> RefToken
  Policy --> Metadata["reference metadata output<br/>immutable script"]
```

Voucher mint paths:

| Redeemer | When used | Asset effect |
| --- | --- | --- |
| `MintVoucher` | Cardano receives a sink-chain packet | Mint voucher tokens to receiver |
| `BurnVoucher` | Cardano sends an existing voucher away | Burn voucher tokens from sender |
| `RefundVoucher` | Timeout or acknowledgement error returns a voucher send | Re-mint voucher tokens to sender |

## Trace Registry

The trace registry is Cardano-local metadata that makes hashed voucher names
reversible. It is intentionally outside HostState because counterparties do not
need it for IBC proof verification.

```mermaid
flowchart TB
  Directory["Directory UTxO<br/>16 bucket pointers"]
  Hash["voucher hash"] --> Bucket["first four bits select bucket"]
  Bucket --> Directory
  Directory --> Active["active shard NFT"]
  Directory --> Archived["archived shard NFTs"]
  Active --> Entries["entries:<br/>voucher_hash -> full_denom"]
  Archived --> Entries
```

```mermaid
sequenceDiagram
  participant Voucher as mint_voucher
  participant Dir as Registry directory
  participant Shard as Active shard
  participant NewShard as New shard

  Voucher->>Shard: first-seen full denom
  Shard->>Shard: verify hash, bucket, active shard, no duplicate
  alt append fits
    Shard->>Shard: append voucher_hash -> full_denom
  else rollover needed
    Shard->>NewShard: create fresh active shard with new entry
    Shard->>Dir: advance bucket pointer
    Dir->>Dir: archive previous active shard
  end
```

Registry invariants:

- inserted `full_denom` must hash to the inserted voucher hash;
- the hash must belong to the selected bucket;
- active shard writes must be authorized by the directory;
- archived shards are immutable history;
- first-seen writes require a matching voucher mint in the same transaction.

## Proof Verification

Proof-bearing operations mint through `verifying_proof.ak`. That minting policy
does not create a lasting asset for users. It is an operation marker proving the
transaction supplied a valid ICS-23 membership or non-membership proof against a
client consensus state root.

```mermaid
flowchart LR
  Client["Client datum<br/>consensus state root"] --> Proof["ICS-23 proof"]
  Path["IBC path"] --> Proof
  Value["expected committed bytes"] --> Proof
  Proof --> Verify["verifying_proof minting policy"]
  Verify --> Marker["proof marker accepted by<br/>connection or channel validator"]
```

The consuming validator checks that the proof marker redeemer is exactly the
proof it expects for the operation.

## Creation Flow

Creation flows mint a new state-thread token and create a new state UTxO, while
HostState increments the appropriate sequence and commits the new key.

```mermaid
sequenceDiagram
  participant Builder as Tx builder
  participant Host as HostState
  participant Mint as State-token policy
  participant State as New state UTxO

  Builder->>Host: spend HostState with CreateClient, CreateConnection, CreateChannel, or BindPort
  Builder->>Mint: mint one derived auth token
  Builder->>State: create datum-carrying output with auth token
  Host->>Host: increment sequence and update commitment root
  Mint->>Mint: verify token name derives from HostState and sequence
```

## Operation Marker Policies

Marker policies are small minting scripts used to prevent a transaction from
claiming one IBC operation while performing another.

```mermaid
flowchart TD
  Operation["Operation"] --> MarkerPolicy["operation marker policy"]
  MarkerPolicy --> Redeemer["redeemer carries target AuthToken"]
  MarkerPolicy --> Mint["mint exactly one marker"]
  Redeemer --> StateValidator["state validator checks marker redeemer"]
  Mint --> StateValidator

  Operation --> Handshake["channel open or close"]
  Operation --> Packet["send, recv, ack, timeout"]
```

The marker usually has no business meaning outside the transaction. Its value is
the coupling: if it is missing, extra, or points at the wrong auth token, the
state transition fails.

## Shutdown Flow

HostState also has shutdown branches. These let the protocol enter and finalize
a shutdown mode without pretending that normal IBC operations are still active.

```mermaid
stateDiagram-v2
  [*] --> Active
  Active --> ShuttingDown: EnterShutdown
  ShuttingDown --> Finalized: FinalizeShutdown
  Finalized --> [*]
```

The shutdown path belongs to HostState because it is a global protocol mode, not
a per-client or per-channel datum transition.

## Development Workflow

Common local commands:

```bash
aiken fmt --check
aiken build --deny
aiken check --deny --skip-tests
aiken check --deny --max-success 1 --property-coverage relative-to-tests
```

`aiken build` generates `plutus.json`, which is consumed by off-chain code. CI
therefore builds the blueprint before Deno off-chain checks.

## How To Read The Tests

The tests have two layers:

```mermaid
flowchart LR
  Unit["Unit and transition tests<br/>datum helper logic"] --> Contract["Contract-shaped tests<br/>real validator calls"]
  Contract --> Model["Model and fuzz tests<br/>multi-step lifecycle properties"]
```

Use [`../../INVARIANTS.md`](../../INVARIANTS.md) as the index. It maps each
important invariant to concrete test labels and explains what the property
actually proves.

## Design Checklist For New On-chain Changes

When adding or changing a validator path, check these questions:

- What is the canonical state UTxO, and which auth token identifies it?
- Which HostState branch commits the state change?
- Which ICS-24 key/value changes must be reflected in the commitment root?
- Does the transaction need an operation marker mint?
- Does it need a proof marker mint?
- Does the transfer module need an application callback?
- If voucher assets are minted, does the trace registry need a first-seen
  witness?
- Which invariant labels in `INVARIANTS.md` should be added or updated?

```mermaid
flowchart TD
  Change["New on-chain operation"] --> State["state thread identified?"]
  State --> Host["HostState root update defined?"]
  Host --> Marker{"needs operation marker?"}
  Marker -->|"yes"| MarkerPolicy["add or reuse marker policy"]
  Marker -->|"no"| Proof{"needs remote proof?"}
  MarkerPolicy --> Proof
  Proof -->|"yes"| Verify["wire verifying_proof redeemer"]
  Proof -->|"no"| App{"application callback?"}
  Verify --> App
  App -->|"yes"| Module["validate module accounting"]
  App -->|"no"| Tests["add invariant tests"]
  Module --> Tests
```
