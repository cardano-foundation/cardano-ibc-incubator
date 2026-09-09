use aiken/cbor
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_history.{
  ConsensusStateDatum, ConsensusStateKey,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{
  ClientMessage, HeaderCase, MisbehaviourCase,
}
use ibc/client/ics_007_tendermint_client/store
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree

/// Experimental internal leaves; public IBC consensus-state values are unchanged.
pub const key_prefix: ByteArray = "internal/consensus-history/v1/"

pub type Witness {
  record: ConsensusStateDatum,
  siblings: List<ByteArray>,
}

fn normalized_token(token: AuthToken) -> AuthToken {
  AuthToken { policy_id: token.policy_id, name: token.name }
}

fn normalized_height(h: Height) -> Height {
  Height {
    revision_number: h.revision_number,
    revision_height: h.revision_height,
  }
}

fn lowercase_hex(bytes: ByteArray) -> ByteArray {
  let alphabet = "0123456789abcdef"
  bytearray.foldr(
    bytes,
    "",
    fn(byte, encoded) {
      encoded
        |> bytearray.push(bytearray.at(alphabet, byte % 16))
        |> bytearray.push(bytearray.at(alphabet, byte / 16))
    },
  )
}

/// The suffix is lowercase hex TEXT of normalized Plutus constructor CBOR.
/// It is not raw CBOR, and does not use definite-list canonical CBOR.
pub fn key(client_token: AuthToken, h: Height) -> ByteArray {
  let encoded =
    cbor.serialise(
      ConsensusStateKey {
        client_token: normalized_token(client_token),
        height: normalized_height(h),
      },
    )
  bytearray.concat(key_prefix, lowercase_hex(encoded))
}

/// Reconstruct every constructor to ignore input CBOR encoding choices.
/// Processing metadata is part of this commitment, unlike the public IBC leaf.
pub fn value(record: ConsensusStateDatum) -> ByteArray {
  cbor.serialise(
    ConsensusStateDatum {
      client_token: normalized_token(record.client_token),
      height: normalized_height(record.height),
      consensus_state: ConsensusState {
        timestamp: record.consensus_state.timestamp,
        next_validators_hash: record.consensus_state.next_validators_hash,
        root: MerkleRoot { hash: record.consensus_state.root.hash },
      },
      processed_time: record.processed_time,
      processed_height: record.processed_height,
    },
  )
}

/// Callers must validate the checkpoint and authenticate the input/output root.
/// An absence witness makes accepted history immutable while its leaf is retained.
pub fn insert(
  root: ByteArray,
  record: ConsensusStateDatum,
  siblings: List<ByteArray>,
) -> ByteArray {
  tree.apply_update(
    root,
    key(record.client_token, record.height),
    "",
    value(record),
    siblings,
  )
}

/// Root authority is the caller's responsibility: a proof against an attacker-
/// supplied root is not evidence of an accepted client checkpoint.
pub fn authenticate(
  root: ByteArray,
  expected_client: AuthToken,
  expected_height: Height,
  record: ConsensusStateDatum,
  siblings: List<ByteArray>,
) -> Bool {
  let record_key = key(expected_client, expected_height)
  and {
    record.client_token.policy_id == expected_client.policy_id,
    record.client_token.name == expected_client.name,
    height.equal(record.height, expected_height),
    tree.compute_root(
      record_key,
      tree.leaf_hash(
        crypto.sha2_256(record_key),
        tree.value_hash(value(record)),
      ),
      siblings,
    ) == root,
  }
}

fn authenticated_live_record(
  client: ClientDatum,
  root: ByteArray,
  witness: Witness,
  current_time: Int,
  h: Height,
) -> ConsensusStateDatum {
  expect authenticate(root, client.token, h, witness.record, witness.siblings)
  expect height.compare(h, client.state.client_state.latest_height) == Less
  expect
    !client_state.is_expired(
      client.state.client_state,
      witness.record.consensus_state.timestamp,
      current_time,
    )
  witness.record
}

/// Hydrate one packet proof height in memory, including immutable delay metadata.
/// The latest checkpoint is already in the authenticated singleton client datum.
pub fn with_witness_at_height(
  client: ClientDatum,
  root: ByteArray,
  witness: Option<Witness>,
  current_time: Int,
  proof_height: Option<Height>,
) -> ClientDatum {
  expect client_datum.has_singleton_history(client)
  when proof_height is {
    None -> {
      expect witness == None
      client
    }
    Some(h) ->
      if height.equal(h, client.state.client_state.latest_height) {
        expect witness == None
        client
      } else {
        expect Some(proof) = witness
        let record =
          authenticated_live_record(client, root, proof, current_time, h)
        ClientDatum {
          ..client,
          state: ClientDatumState {
            ..client.state,
            consensus_states: [
              Pair(h, record.consensus_state),
              ..client.state.consensus_states
            ],
            processed_times: [
              Pair(h, record.processed_time),
              ..client.state.processed_times
            ],
            processed_heights: [
              Pair(h, record.processed_height),
              ..client.state.processed_heights
            ],
          },
        }
      }
  }
}

/// Authenticate only message-relevant history, with at most two distinct leaves.
/// Signature verification remains with the Tendermint verifier. This preserves
/// the prototype's monotone-update model; it does not prove ordered neighbours
/// or that an omitted historical height is absent from the committed tree.
pub fn consensus_states_for_message(
  client: ClientDatum,
  root: ByteArray,
  witnesses: List<Witness>,
  current_time: Int,
  msg: ClientMessage,
) -> Pairs<Height, ConsensusState> {
  expect client_datum.has_singleton_history(client)
  expect
    when witnesses is {
      [] -> True
      [_] -> True
      [_, _] -> True
      _ -> False
    }
  let relevant_heights =
    when msg is {
      HeaderCase(h) -> [h.trusted_height, header.get_height(h)]
      MisbehaviourCase(m) ->
        [m.header1.trusted_height, m.header2.trusted_height]
    }
  list.foldl(
    witnesses,
    client.state.consensus_states,
    fn(witness, states) {
      let h = witness.record.height
      expect
        list.any(relevant_heights, fn(expected) { height.equal(h, expected) })
      expect store.get_consensus_state(states, h) == None
      let record =
        authenticated_live_record(client, root, witness, current_time, h)
      [Pair(h, record.consensus_state), ..states]
    },
  )
}
