# Probabilistic client software upgrades

This is the compatibility contract for [#629](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/629).
A Cosmos host compiles the verifier into its executable. Each client ID selects
stored state, not a separately deployed copy of that executable. Replacing the
host binary changes the implementation used by every instance of the registered
client type. An ordinary compatible replacement retains the database and the
original client, connection and channel identifiers.

Defining and testing this contract does **not** itself require a new release of
the core, v8 or v10 Go modules. The external fixtures use existing immutable
releases. A change to the verifier, schema or module dependencies may separately
require a release; a passing same-module test does not qualify such a change.

## Operations and their boundaries

| Operation | What happens to existing clients and routes? |
| --- | --- |
| First installation | Register the types and implementation in a new host binary, allow the client type, then create clients and perform the connection/channel handshakes. |
| Compatible host software upgrade | The replacement executable reads the original client stores. No new client creation, recovery message or IBC upgrade proof is required. |
| Substitute-client recovery | An authorized recovery imports compatible trusted state into an expired or frozen subject. The connection retains the subject's ID. See the [recovery runbook](./probabilistic-client-recovery.md). |
| Standard IBC `MsgUpgradeClient` | A distinct IBC protocol operation. Both probabilistic adapters currently reject `VerifyUpgradeAndUpdateState`. That rejection does not prevent a host binary upgrade. |
| Incompatible client type or state model | Requires an explicitly designed host migration, or new clients and routes. Creating another client alone never retargets an existing connection. |

Cardano does not approve a new counterparty client instance during a compatible
host upgrade: the existing topology remains in use. General Aiken validator,
HostState deployment and route migration belongs to
[#462](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/462).

## Stable identities and stored data

A release is compatible without migration only if all these conditions hold:

- Preserve `08-cardano-probabilistic`, its host registration/routing, and every
  existing `08-cardano-probabilistic-N` store prefix.
- Preserve `/ibc.lightclients.probabilistic.v1.ClientState`, `ConsensusState`,
  `ProbabilisticHeader`, `Misbehaviour` and `Height` type URLs under that same
  protobuf package. The Go import path or ibc-go major is not a protobuf version.
- Decode historical `ClientState` and `ConsensusState` Any envelopes and their
  values with the same meaning. Never reuse field numbers, change their wire
  types, or reinterpret existing values. Reserve removed numbers and names.
- Evaluate omitted fields explicitly. Adding a protobuf field is not sufficient
  evidence of compatibility: a zero default can make a decoded client inactive
  or make its existing roots unusable.
- Retain decoding for previously supported client messages, including nested
  block/epoch structures, unless a coordinated relayer activation explicitly
  retires them. Decoding and successful cryptographic verification are separate
  obligations; historical messages must not bypass current validity rules.
- Preserve all keys and value encodings that the selected old release actually
  wrote. Audit the complete per-client store, including private metadata, rather
  than exporting only the two protobuf states.

The current key inventory, relative to `clients/<client-id>/`, includes:

| Key family | Contract |
| --- | --- |
| `clientState` | Protobuf Any wrapping the client state. |
| `consensusStates/<revision>-<height>` | Protobuf Any wrapping the consensus state. Preserve all retained usable heights. |
| `consensusStates/<revision>-<height>/processedTime` | Big-endian uint64 host nanoseconds; proof-delay origin. |
| `consensusStates/<revision>-<height>/processedHeight` | Textual host revision-height; proof-delay origin. |
| `iterateConsensusStates` + binary height | Two big-endian uint64 components; value is the consensus-state key. |
| `probabilisticScore/<height>`, `uniquePools/<height>`, `uniqueStake/<height>` | Big-endian uint64 diagnostics. |
| `acceptedBlockHash/<height>` | Stored block-hash text. |
| `operationalCertificateCounterHistory/` + binary height | Private counter rollback history; preserve its version-specific encoding and reconstruction boundary. |
| `epochChallengeCheckpoint/` + big-endian epoch | Private trusted checkpoint used for challenge evidence; present in implementations with epoch challenge windows. Preserve it with the serialized challenge deadlines. |

An older release need not contain a later key family. The candidate must define
how it handles its absence. Storage names, prefixes, byte order and serialization
are protocol state even when the Go identifiers are unexported. The release
review must also cover future keys not listed here.

Connections, channels, packet commitments/receipts/acknowledgements, sequence
counters, transfer escrow, bank balances and denomination traces retain their
existing identities. A host restart must not mint a replacement voucher or
restart packet numbering.

## Activation of verification changes

**Policy: host upgrades activate the selected implementation for all existing
instances at the coordinated host upgrade height.** They do not implicitly pin
an instance to the code that originally created it. Changes to embedded security
parameters have the same activation boundary as other verifier-rule changes.

No new serialized protocol-version field is required to adopt this policy or
to test an unchanged verifier. A candidate that changes semantics must document
the before/after acceptance rules, retained-root treatment, update/misbehaviour
behavior and relayer requirements at that height. A security tightening may
intentionally reject formerly accepted proofs; decoding success must not be
reported as operational compatibility in that case.

If old and new rules must coexist, or activate per client or at a Cardano height
independently of the host upgrade, the candidate must introduce and test an
explicit serialized protocol version/activation boundary (or a distinct client
type). That is separate implementation work and can require a new module
release. Do not infer the rule version from a Go tag, a relayer-supplied field,
an unset default, or the client ID suffix.

## Host application migrations

A host migration is required when the selected implementation cannot safely
read and use retained state under the contract above. Examples include missing
mandatory clock parameters, a rootless checkpoint without its temporal cursor,
changed key encodings, or new security metadata without a safe normal-update
path. Do not silently replace missing metadata with guessed trusted values.

The host app owns migration scheduling and persistence. Record the source and
target artifacts and a migration identifier/version in the app's upgrade
handler; use its SDK module version map where applicable. The v10 light-client
route is not by itself a separately scheduled SDK store migration. Ensure the
handler runs once at the chosen host height, before normal client use.

For each required migration:

1. Load a real old-version database containing active, expired, frozen, rootless
   and historical-consensus cases relevant to the change.
2. Transform state in the app upgrade transaction, with an explicit source
   schema/version check. Preserve security invariants, proof-delay origins,
   counter history and pending challenge evidence.
3. Verify the candidate fails without the migration, succeeds with it, and
   rejects unsupported source versions without partial writes.
4. Restart after the migration and verify it is not applied a second time.
5. Run ordinary root-bearing updates and packet flows on the original route.

Do not claim that all existing published releases can upgrade to the current
checkout without migration. For example, legacy `max_clock_drift = 0` fails
closed, and roots without host-assigned epoch challenge deadlines are initially
unusable in implementations that require those deadlines. Follow the selected
candidate's [temporal porting notes](../cosmos/cardano-probabilistic-light-client-v8/PORTING.md)
and [epoch challenge activation procedure](./probabilistic-light-client.md#bootstrap-recovery-and-deployment).

## Verification and the #603 acceptance gate

The [external fixture](../tests/probabilistic-upgrade/README.md) provides two
different levels of evidence:

- **Published-module store test:** separate host processes initialize and reopen
  an IAVL database using immutable v8/v10 releases from the Go proxy. It verifies
  type URLs, message/state decoding, unchanged client-store bytes, membership
  and non-membership with delay metadata, and rejection of an incompatible
  type URL, metadata-key rename or missing mandatory clock parameter. Host binaries differ only in a fixture
  version string. This is a control showing that replacing the host executable
  does not inherently require a new light-client module release.
- **Live Classic fixture:** starts an old host, creates clients/connection/channel,
  completes a transfer, replaces the binary while retaining the database,
  compares state, and completes another transfer whose ordinary update advances
  the original client ID. It records binary identity, route/client snapshots,
  voucher denomination/trace/balance and packet commitment continuity. Its
  mocked orchestration tests are not live-chain evidence.

For [#603](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/603),
run an equivalent same-client-ID scenario with the **exact selected Injective
before/after binaries**, their complete module/replacement graphs, required app
migrations, and the selected Gateway/Hermes artifacts. The local simd fixture
does not qualify an Injective binary or a v8-to-v10 SDK transition.

Record the host network/chain ID, source commits, binary/image hashes, core and
adapter versions, migration/activation decision, original client/connection/
channel IDs on both chains, and before/after transfer transaction evidence.
Require an original-client update, unchanged route and voucher identity, and
successful packet completion after the upgrade. Link the separate full
conformance results from #648, including timeout/non-membership and restart.
Attach the evidence to #603 before treating retained-client compatibility as
qualified. Adding this gate locally does not update that external issue or
establish production deployment.
