use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/packed
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{Leaf}

fn leaves(index: Int) -> List<Leaf> {
  if index == 45 {
    []
  } else {
    [
      Leaf {
        index,
        pubkey: builtin.integer_to_bytearray(True, 32, index + 1),
        power: 10_000_000 - index,
      },
      ..leaves(index + 1)
    ]
  }
}

fn raw(index: Int) -> ByteArray {
  if index == 45 {
    #""
  } else {
    builtin.append_bytearray(
      builtin.integer_to_bytearray(True, 32, index + 1),
      builtin.append_bytearray(
        builtin.integer_to_bytearray(True, 8, 10_000_000 - index),
        raw(index + 1),
      ),
    )
  }
}

test packed_target_matches_full_admission_and_preserves_metadata() {
  let (actual, vector) = packed.target(raw(0), list.range(0, 44))
  actual == proof.full(leaves(0)) && actual.count == 45 && bytearray.length(
    vector,
  ) == 3240 && bytearray.take(vector, 1800) == raw(0)
}

fn row(key: Int, power: Int) -> ByteArray {
  builtin.append_bytearray(
    builtin.integer_to_bytearray(True, 32, key),
    builtin.integer_to_bytearray(True, 8, power),
  )
}

test packed_single_leaf_matches_all_power_encoding_boundaries() {
  list.all(
    [
      1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456,
      34359738367, 34359738368, 4398046511103, 4398046511104, 562949953421311,
      562949953421312, 72057594037927935, 72057594037927936, 1152921504606846975,
    ],
    fn(power) {
      let key = builtin.integer_to_bytearray(True, 32, 0)
      let (record, vector) = packed.target(row(0, power), [0])
      record == proof.full([Leaf { index: 0, pubkey: key, power }]) && builtin.slice_bytearray(
        0,
        40,
        vector,
      ) == row(0, power)
    },
  )
}

test packed_empty_target_rejected() fail {
  packed.target(#"", []).1st.count == 0
}

test packed_truncated_target_rejected() fail {
  packed.target(bytearray.take(row(1, 1), 39), [0]).1st.count == 1
}

test packed_trailing_target_bytes_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 1), #"00"), [0]).1st.count == 1
}

test packed_zero_power_rejected() fail {
  packed.target(row(1, 0), [0]).1st.count == 1
}

test packed_excessive_power_rejected() fail {
  packed.target(row(1, 1152921504606846976), [0]).1st.count == 1
}

test packed_excessive_total_rejected() fail {
  packed.target(
    builtin.append_bytearray(row(1, 1152921504606846975), row(2, 1)),
    [0, 1],
  ).1st.count == 2
}

test packed_duplicate_key_at_different_power_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(1, 1)), [0, 1]).1st.count == 2
}

test packed_canonical_power_order_required() fail {
  packed.target(builtin.append_bytearray(row(1, 1), row(2, 2)), [0, 1]).1st.count == 2
}

test packed_missing_key_order_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(2, 1)), [0]).1st.count == 2
}

test packed_duplicate_key_order_index_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(2, 1)), [0, 0]).1st.count == 2
}

test packed_extra_key_order_index_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(2, 1)), [0,
      1, 1]).1st.count == 2
}

test packed_reversed_key_order_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(2, 1)), [1, 0]).1st.count == 2
}

test packed_negative_key_order_index_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(2, 1)), [-1, 1]).1st.count == 2
}

test packed_out_of_range_key_order_index_rejected() fail {
  packed.target(builtin.append_bytearray(row(1, 2), row(2, 1)), [0, 2]).1st.count == 2
}

fn oversized(count: Int) -> ByteArray {
  if count == 0 {
    #""
  } else {
    builtin.append_bytearray(row(count, count), oversized(count - 1))
  }
}

test packed_excessive_validator_count_rejected() fail {
  packed.target(oversized(257), list.range(0, 256)).1st.count == 257
}
