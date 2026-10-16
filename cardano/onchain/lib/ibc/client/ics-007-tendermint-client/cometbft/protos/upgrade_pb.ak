use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{ProofSpec}
use ibc/utils/bytes

fn joined(parts: List<ByteArray>) -> ByteArray {
  list.foldl(parts, #"", fn(part, acc) { bytearray.concat(acc, part) })
}

fn uint(field: Int, value: Int) -> ByteArray {
  expect value >= 0
  if value == 0 {
    #""
  } else {
    joined([bytes.encode_varint(field * 8), bytes.encode_varint(value)])
  }
}

// Embedded non-nullable gogo messages must be emitted even when empty.
fn message(field: Int, value: ByteArray) -> ByteArray {
  joined(
    [
      bytes.encode_varint(field * 8 + 2),
      bytes.encode_varint(bytearray.length(value)),
      value,
    ],
  )
}

fn blob(field: Int, value: ByteArray) -> ByteArray {
  if value == #"" {
    #""
  } else {
    message(field, value)
  }
}

fn time(value: Int) -> ByteArray {
  joined([uint(1, value / 1_000_000_000), uint(2, value % 1_000_000_000)])
}

fn proof_spec(spec: ProofSpec) -> ByteArray {
  let leaf = spec.leaf_spec
  let inner = spec.inner_spec
  joined(
    [
      message(
        1,
        joined(
          [
            uint(1, leaf.hash),
            uint(2, leaf.prehash_key),
            uint(3, leaf.prehash_value),
            uint(4, leaf.length),
            blob(5, leaf.prefix),
          ],
        ),
      ),
      message(
        2,
        joined(
          [
            blob(1, joined(list.map(inner.child_order, bytes.encode_varint))),
            uint(2, inner.child_size),
            uint(3, inner.min_prefix_length),
            uint(4, inner.max_prefix_length),
            blob(5, inner.empty_child),
            uint(6, inner.hash),
          ],
        ),
      ),
      uint(3, spec.max_depth),
      uint(4, spec.min_depth),
      uint(
        5,
        if spec.prehash_key_before_comparison {
          1
        } else {
          0
        },
      ),
    ],
  )
}

fn any(type_url: ByteArray, value: ByteArray) -> ByteArray {
  joined([message(1, type_url), message(2, value)])
}

/// The source chain commits ZeroCustomFields(), wrapped in protobuf Any.
pub fn client(state: ClientState) -> ByteArray {
  any(
    "/ibc.lightclients.tendermint.v1.ClientState",
    joined(
      [
        blob(1, state.chain_id),
        message(2, #""),
        message(3, #""),
        message(4, time(state.unbonding_period)),
        message(5, #""),
        message(6, #""),
        message(
          7,
          joined(
            [
              uint(1, state.latest_height.revision_number),
              uint(2, state.latest_height.revision_height),
            ],
          ),
        ),
        joined(
          list.map(state.proof_specs, fn(spec) { message(8, proof_spec(spec)) }),
        ),
        joined(
          list.map(state.upgrade_path, fn(segment) { message(9, segment) }),
        ),
      ],
    ),
  )
}

pub fn consensus(state: ConsensusState) -> ByteArray {
  any(
    "/ibc.lightclients.tendermint.v1.ConsensusState",
    joined(
      [
        message(1, time(state.timestamp)),
        message(2, blob(1, state.root.hash)),
        blob(3, state.next_validators_hash),
      ],
    ),
  )
}
