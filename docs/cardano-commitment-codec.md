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

`Legacy8` names the eight-field Tendermint client commitment on the release
branch's main ancestor. `UpgradePath9` names the nine-field commitment written
by the light-client release branch. They are codec identifiers. They are separate
from the monotonically increasing `HostState.version`, contract generations,
software releases and deployment identities.

Neither existing format has a version envelope. Both use Plutus Data records
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
fields and constructor indexes. Private metadata belongs in separate types.

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
channel counterparty = [port_id, channel_id]
port registration = [module_script_hash, port_token, module_token]
token = [policy_id, name]
```

`proof_specs`, `upgrade_path`, `versions`, `features`, `child_order` and
`connection_hops` are arrays. Chain IDs, identifiers, paths, hashes and opaque
versions are byte arrays. State, ordering and Boolean constructors have no
fields. Their constructor indexes are fixed by the frozen enum declarations.
Connection states are `Uninitialized = 0`, `Init = 1`, `TryOpen = 2` and
`Open = 3`. Channel states add `Closed = 4`. Ordering is `None = 0`,
`Unordered = 1` and `Ordered = 2`. Boolean values are `False = 0` and `True = 1`.
Their CBOR tags are 121 plus the constructor index.

Packet commitments and acknowledgements encode the underlying bytes as a CBOR
byte string. A packet receipt is the empty byte string `0x40`. Sequence leaves
are CBOR unsigned integers. Absence is the empty leaf value, which differs from
the nonempty encoding `0x40` of an existing receipt.

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
caller's value. Channel connection hops compare in order. Both formats omit
`upgrade_sequence`, so an expected nonzero value is rejected. Packet bytes
compare after CBOR decoding. `nextSequenceRecv` compares with ibc-go's eight-byte
big-endian counter.

The public Go adapters support client, consensus, connection, channel, packet
commitment, acknowledgement and `nextSequenceRecv` membership. Receipt
membership remains unsupported because ibc-go expects `0x01`. Port registration
and the other sequence encodings are specified and tested without introducing
a new Cosmos membership API. Non-membership remains available for absent keys.
Semantic checks also run when the caller supplies bytes equal to the proof's
value. Equality cannot bypass the supported codec contract.

## Future activation and retirement

This release preserves existing bytes and supplies both historical readers. It
does not introduce an active-codec field or authorize a codec migration. A mixed
root containing eight-field and nine-field client leaves remains verifiable
because each leaf's shape is authenticated by its original bytes.

A future byte-changing codec needs a distinct authenticated envelope and a
deployment-approved codec policy. HostState must authenticate the write codec
and permitted historical formats. Each accepted consensus root must retain the
policy from its own proof height. Initialization and upgrades must authenticate
that policy against the deployment. Unknown codecs fail closed. An operator
setting cannot reinterpret an accepted historical commitment.

Activation must use a bounded migration under
[issue 462](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/462).
The approved transition must freeze the source inventory and authenticate each
old leaf before checking its replacement and applying its root update. New
leaves carry the new envelope. Unmoved leaves retain their old format under the
transition policy. Completion requires authenticated progress covering the
entire inventory. An interruption must leave old settlement proofs usable.

The existing registry's redeployment path requires unchanged datums and an
unchanged compatibility profile. It cannot authorize this schema migration.
Legacy immutable deployments retain their existing settlement paths. A new
codec does not migrate escrow, vouchers, packet obligations or asset identities.

Deploy the compatible Cosmos readers through
[issue 629](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/629)
before activating a different codec on Cardano. Retain historical readers while
packets, refunds, redemption claims or recovery and retirement proofs depend on
them. Removing a reader requires authenticated evidence that those dependencies
are settled under issues 611 and 737. A grace period alone is insufficient.

These rules cover the byte contract and proof continuity in invariants I1 and I3
of issue 462. Accounting and claim availability remain the I2 and I4 conditions
that gate migration completion and retirement. This first change advances
[issue 614](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/614).
Its authenticated activation and lifecycle acceptance criteria remain open.

## Compatibility vectors

`tests/ibc-state-commitment/codec.json` pins both client formats, all supported
connection states and channel state/order combinations, integer encoding
boundaries, byte-string chunk boundaries and port registrations. It also contains
membership proofs for both client formats under one root. Aiken tests check the
frozen encoders against these bytes. Go tests check decoding, semantic mismatch
rejection and historical membership through every light-client variant.

Regenerate with the repository's pinned Aiken compiler and runtime dependencies:

```sh
node tests/ibc-state-commitment/generate-codec.mjs --write
node tests/ibc-state-commitment/generate-codec.mjs --check
```

`fixtureVersion` identifies the fixture file format. Each vector's `version`
identifies the commitment format. Neither substitutes for deployment authority.
