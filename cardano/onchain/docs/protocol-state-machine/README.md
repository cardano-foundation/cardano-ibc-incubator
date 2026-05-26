# Cardano IBC On-chain State Machine Model

This directory replaces the interactive prototype with a static formal model.
The source of truth is [`model.yaml`](model.yaml): every validator is represented
as a machine participant, and each protocol mechanism is described as
transitions over explicit state spaces.

The model is intentionally not a web app. It should be reviewable in GitHub,
diffable in pull requests, and precise enough to become input for generated
diagrams, invariant checks, or a future TLA+/Alloy model.

## Model Shape

```mermaid
flowchart LR
  State["state_spaces<br/>host, client, connection, channel,<br/>transfer, trace_registry"]
  Validators["validators<br/>every .ak validator as a participant"]
  Mechanisms["mechanisms<br/>auth tokens, HostState root,<br/>markers, proofs, accounting"]
  Machines["state_machines<br/>client, connection, channel,<br/>packet, shutdown"]
  Traces["scenario_traces<br/>ICS-20 send, receive,<br/>ack, timeout"]

  State --> Machines
  Validators --> Mechanisms
  Validators --> Machines
  Mechanisms --> Traces
  Machines --> Traces
```

## Global Machine

The protocol is a composed state machine. A Cardano transaction is a transition
attempt. Validators are transition guards. Outputs and minted assets are the
next-state witness.

```mermaid
flowchart TB
  Tx["Cardano transaction"]

  subgraph "Identity layer"
    HostNFT["host_state_nft"]
    ClientSTT["mint_client_stt"]
    ConnSTT["mint_connection_stt"]
    ChanSTT["mint_channel_stt"]
    Port["mint_port"]
    EscrowShard["mint_transfer_escrow_shard"]
  end

  subgraph "IBC commitment layer"
    Host["host_state_stt"]
    Client["spend_client"]
    Conn["spend_connection"]
    Chan["spend_channel"]
  end

  subgraph "Channel operation layer"
    OpenAck["chan_open_ack"]
    OpenConfirm["chan_open_confirm"]
    CloseInit["chan_close_init"]
    CloseConfirm["chan_close_confirm"]
    Send["send_packet"]
    Recv["recv_packet"]
    Ack["acknowledge_packet"]
    Timeout["timeout_packet"]
  end

  subgraph "Proof and app layer"
    Proof["verifying_proof"]
    Transfer["spend_transfer_module"]
    Voucher["mint_voucher"]
    Metadata["voucher_metadata"]
    Registry["trace_registry"]
  end

  Tx --> Host
  Tx --> Client
  Tx --> Conn
  Tx --> Chan
  Chan --> OpenAck
  Chan --> OpenConfirm
  Chan --> CloseInit
  Chan --> CloseConfirm
  Chan --> Send
  Chan --> Recv
  Chan --> Ack
  Chan --> Timeout
  Proof --> Conn
  Proof --> Chan
  Chan --> Transfer
  Transfer --> Voucher
  Voucher --> Metadata
  Voucher --> Registry
  HostNFT --> Host
  ClientSTT --> Client
  ConnSTT --> Conn
  ChanSTT --> Chan
  Port --> Transfer
  EscrowShard --> Transfer
```

## Lifecycle Machines

### Client

```mermaid
stateDiagram-v2
  [*] --> Uninitialized
  Uninitialized --> Active: CreateClient<br/>host_state_stt + mint_client_stt
  Active --> Active: UpdateClient<br/>spend_client + host_state_stt
  Active --> Frozen: Misbehaviour<br/>spend_client + host_state_stt
  Active --> Expired: time-based status
```

### Connection

```mermaid
stateDiagram-v2
  [*] --> Uninitialized
  Uninitialized --> Init: ConnOpenInit<br/>host_state_stt + mint_connection_stt
  Uninitialized --> TryOpen: ConnOpenTry<br/>host_state_stt + mint_connection_stt + verifying_proof
  Init --> Open: ConnOpenAck<br/>spend_connection + host_state_stt + verifying_proof
  TryOpen --> Open: ConnOpenConfirm<br/>spend_connection + host_state_stt + verifying_proof
```

### Channel

```mermaid
stateDiagram-v2
  [*] --> Uninitialized
  Uninitialized --> Init: ChanOpenInit
  Uninitialized --> TryOpen: ChanOpenTry
  Init --> Open: ChanOpenAck
  TryOpen --> Open: ChanOpenConfirm
  Open --> Closed: ChanCloseInit
  Open --> Closed: ChanCloseConfirm
```

Each channel lifecycle transition is a composed transaction:

```mermaid
flowchart LR
  Chan["spend_channel"]
  Marker["operation marker helper"]
  Host["host_state_stt.UpdateChannel"]
  Proof["verifying_proof<br/>if remote proof is required"]
  Module["spend_transfer_module<br/>IBC module callback"]

  Chan --> Marker
  Chan --> Host
  Proof -. proof-bearing transitions .-> Chan
  Chan --> Module
```

### Packet

```mermaid
stateDiagram-v2
  [*] --> None
  None --> CommitmentWritten: SendPacket
  CommitmentWritten --> AcknowledgementWritten: RecvPacket
  AcknowledgementWritten --> Completed: AcknowledgePacket
  CommitmentWritten --> TimedOut: TimeoutPacket
```

Packet transitions are where most of the protocol coupling becomes visible:

```mermaid
flowchart TB
  Send["SendPacket"]
  Recv["RecvPacket"]
  Ack["AcknowledgePacket"]
  Timeout["TimeoutPacket"]

  Channel["spend_channel dispatcher"]
  Host["host_state_stt.HandlePacket"]
  Proof["verifying_proof"]
  Transfer["spend_transfer_module"]
  Voucher["mint_voucher"]
  Registry["trace_registry"]

  Send --> Channel
  Recv --> Channel
  Ack --> Channel
  Timeout --> Channel
  Channel --> Host
  Recv --> Proof
  Ack --> Proof
  Timeout --> Proof
  Channel --> Transfer
  Transfer --> Voucher
  Voucher --> Registry
```

## Validator Inventory

The validator inventory in [`model.yaml`](model.yaml) includes all non-test
validators under `cardano/onchain/validators`, including protocol validators,
operation helper policies, reference-only helpers, compile support validators,
and local/test stubs. The important production machines are:

| Machine | Source | Role |
| --- | --- | --- |
| `host_state_nft` | `validators/host_state_nft.ak` | root HostState identity |
| `host_state_stt` | `validators/host_state_stt.ak` | global commitment root transition checker |
| `mint_client_stt` | `validators/minting_client_stt.ak` | client state-thread token |
| `spend_client` | `validators/spending_client.ak` | client update and misbehaviour |
| `mint_connection_stt` | `validators/minting_connection_stt.ak` | connection state-thread token |
| `spend_connection` | `validators/spending_connection.ak` | proof-bearing connection updates |
| `mint_channel_stt` | `validators/minting_channel_stt.ak` | channel state-thread token |
| `spend_channel` | `validators/spending_channel.ak` | channel dispatcher and HostState coupling |
| `send_packet` | `validators/spending_channel/send_packet.ak` | SendPacket checks and marker |
| `recv_packet` | `validators/spending_channel/recv_packet.ak` | RecvPacket checks and marker |
| `acknowledge_packet` | `validators/spending_channel/acknowledge_packet.ak` | ack checks and marker |
| `timeout_packet` | `validators/spending_channel/timeout_packet.ak` | timeout checks and marker |
| `spend_transfer_module` | `validators/spending_transfer_module.ak` | ICS-20 callbacks and accounting |
| `mint_voucher` | `validators/minting_voucher.ak` | voucher mint, burn, refund |
| `trace_registry` | `validators/trace_registry.ak` | voucher trace reverse lookup |
| `verifying_proof` | `validators/verifying_proof.ak` | ICS-23 proof marker |

## How To Extend The Model

When a validator branch changes, update the same information in
[`model.yaml`](model.yaml):

- add or update the validator entry;
- update the affected mechanism;
- update the lifecycle transition;
- update scenario traces for user-visible flows such as ICS-20 send, receive,
  acknowledgement, timeout, channel open, or shutdown;
- cross-check the related labels in [`../../../../INVARIANTS.md`](../../../../INVARIANTS.md).
