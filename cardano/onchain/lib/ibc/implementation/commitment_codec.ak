// Frozen commitment layouts. Do not add fields or reorder wire constructors.
// See docs/cardano-commitment-codec.md for the supported historical formats.
use aiken/cbor
use aiken/collection/list
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty} as channel_counterparty
use ibc/core/ics_023_vector_commitments/ics23/proofs.{ProofSpec}
use ibc/core/ics_025_handler_interface/host_state.{ModuleRegistration}

// These existing protocol primitives already define fixed public wire ABIs.
// Keep their field order frozen rather than copying identical record codecs.
pub type WireHeight =
  Height

pub type WireTrustLevel {
  numerator: Int,
  denominator: Int,
}

pub type WireRoot {
  hash: ByteArray,
}

pub type WireBool {
  WireFalse
  WireTrue
}

pub type WireLeaf {
  hash: Int,
  prehash_key: Int,
  prehash_value: Int,
  length: Int,
  prefix: ByteArray,
}

pub type WireInner {
  child_order: List<Int>,
  child_size: Int,
  min_prefix_length: Int,
  max_prefix_length: Int,
  empty_child: ByteArray,
  hash: Int,
}

pub type WireProofSpec {
  leaf_spec: WireLeaf,
  inner_spec: WireInner,
  max_depth: Int,
  min_depth: Int,
  prehash_key_before_comparison: WireBool,
}

pub type LegacyClientState {
  chain_id: ByteArray,
  trust_level: WireTrustLevel,
  trusting_period: Int,
  unbonding_period: Int,
  max_clock_drift: Int,
  frozen_height: WireHeight,
  latest_height: WireHeight,
  proof_specs: List<WireProofSpec>,
}

// Public payload view after the registered client validator authenticates the
// datum. Nested protocol records remain opaque here to avoid validating the
// same fields twice in an already near-limit HostState script.
pub type ClientPayload {
  chain_id: Data,
  trust_level: Data,
  trusting_period: Data,
  unbonding_period: Data,
  max_clock_drift: Data,
  frozen_height: Data,
  latest_height: WireHeight,
  proof_specs: Data,
  upgrade_path: Data,
}

pub type WireConsensusState {
  timestamp: Int,
  next_validators_hash: ByteArray,
  root: WireRoot,
}

pub type WireChannel {
  state: Data,
  ordering: Data,
  counterparty: ChannelCounterparty,
  connection_hops: List<ByteArray>,
  version: ByteArray,
}

fn wire_height(value: Height) -> WireHeight {
  Height {
    revision_number: value.revision_number,
    revision_height: value.revision_height,
  }
}

fn wire_specs(specs: List<ProofSpec>) -> List<WireProofSpec> {
  list.map(
    specs,
    fn(spec) {
      let leaf = spec.leaf_spec
      let inner = spec.inner_spec
      WireProofSpec {
        leaf_spec: WireLeaf {
          hash: leaf.hash,
          prehash_key: leaf.prehash_key,
          prehash_value: leaf.prehash_value,
          length: leaf.length,
          prefix: leaf.prefix,
        },
        inner_spec: WireInner {
          child_order: inner.child_order,
          child_size: inner.child_size,
          min_prefix_length: inner.min_prefix_length,
          max_prefix_length: inner.max_prefix_length,
          empty_child: inner.empty_child,
          hash: inner.hash,
        },
        max_depth: spec.max_depth,
        min_depth: spec.min_depth,
        prehash_key_before_comparison: if spec.prehash_key_before_comparison {
          WireTrue
        } else {
          WireFalse
        },
      }
    },
  )
}

pub fn client_payload(raw: Data) -> ClientPayload {
  expect wire: ClientPayload = raw
  wire
}

// The registered adapter and its paired spend/factory validate nested records.
// This shared view freezes the public envelope independently of private data.
pub fn encode_client_state(raw: Data) -> ByteArray {
  // commitment_view already checked the frozen envelope in this transaction.
  cbor.serialise(raw)
}

// Historical vector support only. Production writes use the nine-field format.
pub fn encode_legacy_client_state(value: ClientState) -> ByteArray {
  expect value.upgrade_path == []
  cbor.serialise(
    LegacyClientState {
      chain_id: value.chain_id,
      trust_level: WireTrustLevel {
        numerator: value.trust_level.numerator,
        denominator: value.trust_level.denominator,
      },
      trusting_period: value.trusting_period,
      unbonding_period: value.unbonding_period,
      max_clock_drift: value.max_clock_drift,
      frozen_height: wire_height(value.frozen_height),
      latest_height: wire_height(value.latest_height),
      proof_specs: wire_specs(value.proof_specs),
    },
  )
}

pub fn encode_consensus_state(raw: Data) -> ByteArray {
  // The paired registered client validator checks this frozen consensus shape.
  cbor.serialise(raw)
}

pub fn encode_connection(value: ConnectionEnd) -> ByteArray {
  // ConnectionEnd and its state enum are frozen wire primitives pinned by
  // wire-schema.lock.json. Copying them into wire records does not fit HostState.
  cbor.serialise(value)
}

pub fn encode_channel(value: Channel) -> ByteArray {
  let state: Data = channel.convert_to_state_proto(value.state)
  let ordering: Data = channel.convert_to_order_proto(value.ordering)
  cbor.serialise(
    WireChannel {
      state,
      ordering,
      counterparty: value.counterparty,
      connection_hops: value.connection_hops,
      version: value.version,
    },
  )
}

/// The fresh deployment's six-field public layout is pinned by the wire-schema
/// lock. Keep the historical five-field encoder above unchanged.
pub fn encode_upgradable_channel(value: Channel) -> ByteArray {
  cbor.serialise(value)
}

pub fn encode_registration(value: ModuleRegistration) -> ByteArray {
  // This immutable authority record is itself a frozen public wire primitive.
  cbor.serialise(value)
}

pub fn encode_sequence(value: Int) -> ByteArray {
  cbor.serialise(value)
}

pub fn encode_bytes(value: ByteArray) -> ByteArray {
  cbor.serialise(value)
}
