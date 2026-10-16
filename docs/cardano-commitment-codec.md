# Cardano commitment codec

HostState authenticates the bytes of each IBC leaf. The sparse tree hashes those
bytes before Go compares their meaning with the value expected by ibc-go. An
equivalent decoded value never permits a different root.

The frozen Aiken encoders live in `ibc/implementation/commitment_codec.ak`.
Shared Go readers and comparisons live in
`cosmos/cardano-probabilistic-light-client-core/commitmentcodec`. The Go package
does not depend on a Cosmos SDK or ibc-go major version. The adapters supply the
expected protobuf fields. Registered Cardano client adapters must project any
changed private datum into the frozen public payload schema. HostState uses
one frozen public client-envelope view. It retains nested records as opaque Data
because the paired registered client validator already validates them. Changes
to those nested layouts must preserve the specified bytes or introduce an
explicit codec transition. The cross-language vectors pin their encodings.

## Existing formats

`Legacy8`, codec 0, names the eight-field Tendermint client commitment on the
release branch's main ancestor. `UpgradePath9`, codec 1, names the nine-field
commitment written by the light-client release branch. They are codec identifiers. They are separate
from the monotonically increasing `HostState.version`, contract generations,
software releases and deployment identities.

Neither existing format has a codec envelope (see below). Both use Plutus Data records
with constructor zero, encoded using CBOR tag 121. The authenticated client
record's exact field count distinguishes these two existing formats. The reader
rejects other field counts and a malformed nine-field record cannot fall back
to eight-field decoding. Other leaf layouts are identical in both formats.

Writers use ledger `serialiseData` bytes. Nonempty arrays are indefinite and
empty arrays are definite. Integers use their minimal mathematical encoding.
Byte strings longer than 64 bytes use chunks of at most 64 bytes. These rules
preserve the release branch's existing value bytes and ordinary roots. Readers
also accept definite arrays with the same fields. They reject unsupported record
constructors, trailing bytes, null values in place of fields and malformed enum
constructors. They hash the original proof bytes rather than re-encoding them.

`Height`, `AuthToken`, connection `Version`, `MerklePrefix` and the two
counterparty records and `ModuleRegistration` are existing public protocol
primitives shared with the encoders. So are `ConnectionEnd`, `Channel`, their
state enums and `Order`, which HostState serialises directly because projecting
them into copies does not fit its reference script. Their declarations are part
of this frozen ABI, and `cardano/onchain/wire-schema.lock.json` pins their
fields and constructor indexes. The channel-upgrade deployment pins the new
six-field `Channel` layout. The historical five-field encoder remains separate
for the compatibility vectors. Private metadata belongs in separate types.

Record fields appear in exactly this order. Nested records also use constructor
zero. `bytes` means a Plutus byte array. Supported counters and timestamps fit an
unsigned 64-bit integer. Proof specification numbers fit their protobuf fields.

```text
Legacy8 client = [chain_id, trust_level, trusting_period, unbonding_period,
                 max_clock_drift, frozen_height, latest_height, proof_specs]
UpgradePath9 client = [all eight fields above, upgrade_path]
trust_level = [numerator, denominator]
height = [revision_number, revision_height]
proof_spec = [leaf_spec, inner_spec, max_depth, min_depth,
              prehash_key_before_comparison]
leaf_spec = [hash, prehash_key, prehash_value, length, prefix]
inner_spec = [child_order, child_size, min_prefix_length, max_prefix_length,
              empty_child, hash]
consensus = [timestamp, next_validators_hash, root]
root = [hash]
connection = [client_id, versions, state, counterparty, delay_period]
version = [identifier, features]
connection counterparty = [client_id, connection_id, prefix]
prefix = [key_prefix]
channel = [state, ordering, counterparty, connection_hops, version]
channel with upgrades = [state, ordering, counterparty, connection_hops, version,
                         upgrade_sequence]
channel counterparty = [port_id, channel_id]
port registration = [module_script_hash, port_token, module_token]
token = [policy_id, name]
packet lane = [port_id, channel_id, lane, lane_count, version, root,
               commitments, receipts, acknowledgements,
               minimum_receive_proof_height, maximum_receive_proof_height,
               balances]
channel upgrade = [fields, timeout, next_sequence_send]
upgrade fields = [ordering, connection_hops, version]
upgrade timeout = [height, timestamp]
upgrade error receipt = [sequence, message]
```

`proof_specs`, `upgrade_path`, `versions`, `features`, `child_order` and
`connection_hops` are arrays. Chain IDs, identifiers, paths, hashes and opaque
versions are byte arrays. State, ordering and Boolean constructors have no
fields. Their constructor indexes are fixed by the frozen enum declarations.
Connection states are `Uninitialized = 0`, `Init = 1`, `TryOpen = 2` and
`Open = 3`. Channel states add `Closed = 4`. The fresh channel-upgrade deployment
also has `Flushing = 5` and `FlushComplete = 6`. Ordering is `None = 0`,
`Unordered = 1` and `Ordered = 2`. Boolean values are `False = 0` and `True = 1`.
Their CBOR tags are 121 plus the constructor index.

Packet commitments and acknowledgements encode the underlying bytes as a CBOR
byte string. A packet receipt is the empty byte string `0x40`. Sequence leaves
are CBOR unsigned integers. Absence is the empty leaf value, which differs from
the nonempty encoding `0x40` of an existing receipt.

## Protected source records

The schema guard starts from these records and follows their referenced types.
This is the destination verifier interface, including datums read while advancing
packet snapshots as well as values authenticated by commitment proofs.

| Protected record | Destination reader |
| --- | --- |
| `HostStateDatum` | Shared core `host_state.go` reads the authenticated HostState output |
| Tendermint `ClientState` | Shared `commitmentcodec/decode.go` reads the client commitment |
| Tendermint `ConsensusState` | Shared `commitmentcodec/decode.go` reads the consensus commitment |
| `ConnectionEnd` | Shared `commitmentcodec/decode.go` reads the connection commitment |
| `Channel` | Shared `cardanodatum/channel.go` reads the channel commitment |
| `PacketLaneDatum` | Shared `packet_lane_commitment.go` reads tracked lane continuations in the snapshot engine |
| Channel `Upgrade` | Shared `cardanodatum/channel.go` compares the record for the v8 adapter |
| Channel `ErrorReceipt` | Shared `cardanodatum/channel.go` compares the record for the v8 adapter |

The upgrade roots include `UpgradeFields` and `UpgradeTimeout`. Existing roots
already reach `Height`, `AuthToken`, `ModuleRegistration`, proof specifications,
counterparties and state enums. Scalar packet and sequence leaves use the frozen
encoders and cross-language vectors described above. The v10 adapter rejects
channel-upgrade proofs because ibc-go v10 does not implement that protocol.

Private client and channel datum wrappers, redeemers and internal upgrade state
are not additional roots. Their presence in Go type declarations alone does not
make them destination verifier inputs. The existing always-failing
`include_unused_types` validator exposes the otherwise opaque packet-lane and
upgrade types in the normal Aiken blueprint. It is not deployed. Only the listed
roots and their references are locked.

Run `aiken build --deny` in `cardano/onchain`, then
`node scripts/ci/check-aiken-wire-schema.mjs check --base-ref origin/main` from
the repository root. Lock version 7 extends coverage without changing an on-chain
record layout or commitment codec. A coverage extension must retain earlier roots
and increase the lock version.

The checker separately pins the reviewed destination interface in
`DESTINATION_WIRE_SCHEMA_FINGERPRINT`. `update --version N` regenerates the lock
but does not update that pin. A changed constructor, field order, field type or
field count still fails the compatibility check after a version bump. Changing
the pin requires reviewing the destination readers and the codec or deployment
transition. Passing this source check does not approve an on-chain deployment or
teach an already deployed Injective module a new layout. Existing hosts need
compatible readers or an explicitly coordinated transition before new bytes are
used. Historical decoders and their compatibility vectors must remain available.
Direct UTxO datums such as `PacketLaneDatum` are not versioned by the
commitment-leaf envelope. Changing their layout needs compatible datum readers
or a new deployment.

## Keys and semantic comparison

Client states use `clients/<client-id>/clientState`. Consensus states use
`clients/<client-id>/consensusStates/<revision-number>-<revision-height>` in the
release branch. Earlier deployments used the revision height alone. Key changes
affect roots independently of the value codec. Historical proofs must use the
key authenticated by their historical root. This codec change does not rewrite
keys or alter the adapters' existing path translation rules.

Connections use `connections/<connection-id>`. Channels use
`channelEnds/ports/<port-id>/channels/<channel-id>`. Sequence prefixes are
`nextSequenceSend`, `nextSequenceRecv` and `nextSequenceAck` followed by the same
port and channel components. Packet prefixes are `commitments`, `acks` and
`receipts` followed by those components and `/sequences/<sequence>`. Port
registrations use `ports/<port-id>`. The external Merkle path requires the `ibc`
namespace before the object key.

Go checks every supported client and proof-specification field. `Legacy8`
authenticates only an empty `upgrade_path`. Both formats omit the deprecated
Tendermint update flags, whose only supported interpretation is `false`.
An expected nondefault omitted field is rejected. Protobuf `Any` wrappers must
name the corresponding Tendermint type. The legacy concrete-protobuf API remains
supported.

Consensus fields compare exactly. Connection versions compare in record order
and their feature arrays compare as unordered collections without changing the
caller's value. Channel connection hops compare in order. The historical
five-field channel omits `upgrade_sequence`, so an expected nonzero value is
rejected. The six-field channel compares the sequence exactly. Packet bytes
compare after CBOR decoding. `nextSequenceRecv` compares with ibc-go's eight-byte
big-endian counter.

The public Go adapters support client, consensus, connection, channel, packet
commitment, acknowledgement and `nextSequenceRecv` membership. Receipt
membership remains unsupported because ibc-go expects `0x01`. Port registration
and the other sequence encodings are specified and tested without introducing
a new Cosmos membership API. Non-membership remains available for absent keys.
Semantic checks also run when the caller supplies bytes equal to the proof's
value. Equality cannot bypass the supported codec contract.

## Codec versions and activation

Codec numbers identify commitment formats. Codec 0 is `Legacy8`, the layouts on
the release branch's main ancestor. Codec 1 is this release's layouts: the
nine-field `UpgradePath9` client, the five-field channel end of earlier
deployments, and the six-field channel end and channel-upgrade records of the
fresh channel-upgrade deployment (see `tests/ibc-state-commitment/channel-upgrade.json`).
A record's authenticated field count tells the channel and client layouts apart.
Neither codec has an envelope. A later codec N, with N > 1, writes every leaf as
the Plutus Data value `Constr 1 [N, payload]`: CBOR tag 122 around a two-element
array. `CodecEnvelope` in `commitment_codec.ak` defines it. No codec 0 or 1 leaf
is a top-level constructor 1, so an enveloped leaf cannot be read as an earlier
codec, and an envelope cannot name codec 0 or 1. Codec numbers are never reused.

Each leaf therefore names the codec that wrote it, and the proof authenticates
that name with the rest of the leaf. The light clients check it before decoding.
A reader rejects every codec it does not implement with `ErrUnsupportedCodec`,
including a malformed envelope. No operator setting or client parameter selects
a codec, so no setting can reinterpret an accepted historical commitment. A root
may hold leaves from several codecs, and each leaf is verified under its own.

The six-field channel writer requires a fresh schema-6 Cardano deployment. It
does not authorize a migration of existing state or assets into that deployment.

Activating a codec takes three steps:

1. Release readers for it to every supported light-client variant and
   counterparty through
   [issue 629](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/629).
   Earlier readers keep rejecting it, so a counterparty that has not upgraded
   fails closed.
2. Deploy a HostState that writes it. That deployment, authorized under
   [issue 462](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/462),
   is the activation. The deployment's identity authenticates which codec its
   HostState writes.
3. Existing leaves keep their codec until a later write replaces them, so no
   re-encoding is required. Re-encoding a whole inventory must be a bounded
   migration under issue 462. The approved transition freezes the source
   inventory and authenticates each old leaf before checking its replacement and
   applying its root update. Completion requires authenticated progress covering
   the entire inventory. An interruption must leave old settlement proofs usable.

The existing registry's redeployment path requires unchanged datums and an
unchanged compatibility profile. It cannot authorize a codec change. Legacy
immutable deployments retain their existing settlement paths.

Retain a reader while packets, refunds, redemption claims or recovery and
retirement proofs depend on leaves in its codec. Removing a reader requires
authenticated evidence under issues 611 and 737 that those dependencies are
settled. A grace period alone is insufficient.

These rules map onto issue 462's shared invariants:

- I1, identity and authority: codec numbers are never reused, and the deployment
  that writes a codec is authenticated with the rest of the deployment.
- I2, accounting and backing: a codec changes encoding only. It moves no escrow,
  vouchers or packet obligations, and a re-encoding migration must preserve each
  leaf's decoded value.
- I3, migration and proof continuity: earlier leaves stay verifiable under their
  own codec, including in roots written after an upgrade.
- I4, retirement and redemption availability: a reader retires only with the
  authenticated evidence above.

Canonical IBC protobuf bytes were not adopted. Encoding protobuf in Aiken would
put an encoder for every committed type into the HostState script, which is at
its reference-script size limit, and every existing root already commits these
CBOR values. A protobuf format could still be introduced later as an enveloped
codec.

## Compatibility vectors

`tests/ibc-state-commitment/codec.json` pins both client formats, all supported
connection states and channel state/order combinations, integer encoding
boundaries, byte-string chunk boundaries, port registrations and codec 2 and 3
envelopes. It also contains membership proofs for both client formats under one
root, and for a codec 1 and a codec 2 packet commitment under another. Aiken tests check the
frozen encoders against these bytes. Go tests check decoding, semantic mismatch
rejection, envelope rejection and historical membership through every
light-client variant.

Regenerate with the repository's pinned Aiken compiler and runtime dependencies:

```sh
node tests/ibc-state-commitment/generate-codec.mjs --write
node tests/ibc-state-commitment/generate-codec.mjs --check
```

`fixtureVersion` identifies the fixture file format. Each vector's `version`
identifies its commitment codec. Neither substitutes for deployment authority.
