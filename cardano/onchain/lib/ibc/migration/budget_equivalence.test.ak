use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/fuzz
use aiken/math
use aiken/primitive/bytearray
use ibc/apps/transfer/trace_registry as registry
use ibc/apps/transfer/voucher_metadata
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use ibc/utils/string as strings

// Independent scalar hex oracle: deliberately does not use the lookup table.
fn hex_reference(bytes: ByteArray) -> ByteArray {
  bytearray.foldr(
    bytes,
    #"",
    fn(byte, rest) {
      let high = byte / 16
      let low = byte % 16
      builtin.cons_bytearray(
        if high < 10 {
          high + 48
        } else {
          high + 87
        },
        builtin.cons_bytearray(
          if low < 10 {
            low + 48
          } else {
            low + 87
          },
          rest,
        ),
      )
    },
  )
}

test migration_budget_equivalence_metadata_runtime(
  input via fuzz.tuple(
    fuzz.bytearray_between(0, 64),
    fuzz.bytearray_between(0, 64),
  ),
) {
  let (policy, token) = input
  fuzz.label(@"fuzz.unit.migration.metadata.dynamic-policy-and-asset-bytes")
  let denom = "transfer/channel-0/stake"
  let expected =
    builtin.constr_data(
      0,
      [
        builtin.map_data(
          [
            Pair(builtin.b_data("name"), builtin.b_data("stake")),
            Pair(builtin.b_data("ticker"), builtin.b_data("stake")),
            Pair(
              builtin.b_data("description"),
              builtin.b_data("IBC voucher for transfer/channel-0/stake"),
            ),
          ],
        ),
        builtin.i_data(1),
        builtin.map_data(
          [
            Pair(builtin.b_data("path"), builtin.b_data("transfer/channel-0")),
            Pair(builtin.b_data("baseDenom"), builtin.b_data("stake")),
            Pair(builtin.b_data("fullDenom"), builtin.b_data(denom)),
            Pair(
              builtin.b_data("ibcDenomHash"),
              builtin.b_data(hex_reference(builtin.sha2_256(denom))),
            ),
            Pair(builtin.b_data("traceVersion"), builtin.i_data(1)),
            Pair(
              builtin.b_data("voucherPolicyId"),
              builtin.b_data(hex_reference(policy)),
            ),
            Pair(
              builtin.b_data("voucherTokenName"),
              builtin.b_data(hex_reference(token)),
            ),
          ],
        ),
      ],
    )
  voucher_metadata.build_datum(denom, token, policy) == expected
}

fn unique_reference(values: List<a>) -> Bool {
  when values is {
    [] -> True
    [head, ..tail] -> !list.has(tail, head) && unique_reference(tail)
  }
}

fn valid_name(name: ByteArray) -> Bool {
  bytearray.length(name) > 0 && bytearray.length(name) <= 32
}

// Original declarative constraints, independent of the optimized bitmap/loop.
fn directory_reference(d: registry.TraceRegistryDirectoryDatum) -> Bool {
  and {
    list.length(d.buckets) <= 16,
    bytearray.length(cbor.serialise(registry.Directory(d))) <= 6144,
    unique_reference(list.map(d.buckets, fn(b) { b.bucket_index })),
    list.all(
      d.buckets,
      fn(b) {
        and {
          b.bucket_index >= 0 && b.bucket_index < 16,
          valid_name(b.active_shard_name),
          list.length(b.archived_shard_names) <= 8,
          list.all(b.archived_shard_names, valid_name),
          unique_reference(b.archived_shard_names),
          !list.has(b.archived_shard_names, b.active_shard_name),
        }
      },
    ),
  }
}

test migration_budget_equivalence_directory(
  seed via fuzz.int_between(0, 1000000),
) {
  let scenario = seed % 10
  let buckets =
    list.range(0, 15)
      |> list.map(
          fn(i) {
            registry.TraceRegistryDirectoryBucket {
              bucket_index: ( i + seed ) % 16,
              active_shard_name: "active",
              archived_shard_names: if seed % 2 == 0 {
                []
              } else {
                ["a", "b", "c"]
              },
            }
          },
        )
  expect [first, second, ..rest] = buckets
  let changed =
    when scenario is {
      0 -> {
        fuzz.label(@"fuzz.unit.migration.directory.valid-permutation")
        buckets
      }
      1 -> {
        fuzz.label(@"fuzz.unit.migration.directory.duplicate-index")
        [first, first, ..rest]
      }
      2 -> {
        fuzz.label(@"fuzz.unit.migration.directory.negative-index")
        [
          registry.TraceRegistryDirectoryBucket { ..first, bucket_index: -1 },
          second,
          ..rest
        ]
      }
      3 -> {
        fuzz.label(@"fuzz.unit.migration.directory.out-of-range-index")
        [
          registry.TraceRegistryDirectoryBucket { ..first, bucket_index: 16 },
          second,
          ..rest
        ]
      }
      4 -> {
        fuzz.label(@"fuzz.unit.migration.directory.empty-name")
        [
          registry.TraceRegistryDirectoryBucket {
            ..first,
            active_shard_name: #"",
          },
          second,
          ..rest
        ]
      }
      5 -> {
        fuzz.label(@"fuzz.unit.migration.directory.archive-cap")
        [
          registry.TraceRegistryDirectoryBucket {
            ..first,
            archived_shard_names: list.repeat("a", 9),
          },
          second,
          ..rest
        ]
      }
      6 -> {
        fuzz.label(@"fuzz.unit.migration.directory.duplicate-archive")
        [
          registry.TraceRegistryDirectoryBucket {
            ..first,
            archived_shard_names: ["a", "a"],
          },
          second,
          ..rest
        ]
      }
      7 -> {
        fuzz.label(@"fuzz.unit.migration.directory.active-in-archive")
        [
          registry.TraceRegistryDirectoryBucket {
            ..first,
            archived_shard_names: ["active"],
          },
          second,
          ..rest
        ]
      }
      8 -> {
        fuzz.label(@"fuzz.unit.migration.directory.bucket-cap")
        [first, ..buckets]
      }
      _ -> {
        fuzz.label(@"fuzz.unit.migration.directory.name-length")
        [
          registry.TraceRegistryDirectoryBucket {
            ..first,
            active_shard_name: builtin.replicate_byte(33, 1),
          },
          second,
          ..rest
        ]
      }
    }
  let directory = registry.TraceRegistryDirectoryDatum { buckets: changed }
  let expected = directory_reference(directory)
  and {
    expected == ( scenario == 0 ),
    registry.directory_is_within_capacity(directory) == expected,
  }
}

const zero = #"0000000000000000000000000000000000000000000000000000000000000000"

fn reference_leaf(key_hash: ByteArray, value: ByteArray) -> ByteArray {
  if value == #"" {
    zero
  } else {
    builtin.sha2_256(
      builtin.append_bytearray(
        #"00",
        builtin.append_bytearray(key_hash, builtin.sha2_256(value)),
      ),
    )
  }
}

fn reference_root(
  key_hash: ByteArray,
  leaf: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  list.indexed_map(siblings, fn(level, sibling) { (level, sibling) })
    |> list.foldl(
        leaf,
        fn(item, current) {
          let (level, sibling) = item
          let direction =
            builtin.index_bytearray(key_hash, 7 - level / 8) / math.pow(
              2,
              level % 8,
            ) % 2
          if current == zero && sibling == zero {
            zero
          } else {
            builtin.sha2_256(
              builtin.append_bytearray(
                #"01",
                if direction == 0 {
                  builtin.append_bytearray(current, sibling)
                } else {
                  builtin.append_bytearray(sibling, current)
                },
              ),
            )
          }
        },
      )
}

test migration_budget_equivalence_dual_root(
  input via fuzz.tuple4(
    fuzz.bytearray_between(1, 40),
    fuzz.bytearray_between(0, 40),
    fuzz.bytearray_between(0, 40),
    fuzz.bytearray_fixed(8),
  ),
) {
  let (key, old, new, occupied_levels) = input
  fuzz.label(
    if old == #"" {
      @"fuzz.unit.migration.tree.insert"
    } else if new == #"" {
      @"fuzz.unit.migration.tree.delete"
    } else {
      @"fuzz.unit.migration.tree.replace"
    },
  )
  let key_hash = builtin.sha2_256(key)
  let siblings =
    list.range(0, 63)
      |> list.map(
          fn(i) {
            if builtin.read_bit(occupied_levels, i) {
              builtin.sha2_256(builtin.cons_bytearray(i, key))
            } else {
              zero
            }
          },
        )
  let old_root =
    reference_root(key_hash, reference_leaf(key_hash, old), siblings)
  let expected_new =
    reference_root(key_hash, reference_leaf(key_hash, new), siblings)
  tree.apply_update(old_root, key, old, new, siblings) == expected_new
}

// Independent scalar decoder: character ranges, ordinary list recursion and
// direct nibble arithmetic. It shares no table or traversal with production.
fn reference_nibble(char: Int) -> Option<Int> {
  if char >= 48 && char <= 57 {
    Some(char - 48)
  } else if char >= 65 && char <= 70 {
    Some(char - 55)
  } else if char >= 97 && char <= 102 {
    Some(char - 87)
  } else {
    None
  }
}

fn reference_decode_hex(chars: List<Int>) -> Option<ByteArray> {
  when chars is {
    [] -> Some(#"")
    [high, low, ..rest] ->
      when
        (
          reference_nibble(high),
          reference_nibble(low),
          reference_decode_hex(rest),
        )
      is {
        (Some(high), Some(low), Some(rest)) ->
          Some(builtin.cons_bytearray(16 * high + low, rest))
        _ -> None
      }
    _ -> None
  }
}

test migration_budget_hex_all_character_values_in_both_positions() {
  list.all(
    list.range(0, 255),
    fn(char) {
      let high = builtin.cons_bytearray(char, #"30")
      let low = builtin.cons_bytearray(48, builtin.cons_bytearray(char, #""))
      and {
        strings.hex_string_to_bytes(high) == reference_decode_hex([char, 48]),
        strings.hex_string_to_bytes(low) == reference_decode_hex([48, char]),
      }
    },
  )
}

test migration_budget_hex_preserves_order_case_zeros_and_empty() {
  and {
    strings.hex_string_to_bytes("aB00fF9C") == Some(#"ab00ff9c"),
    strings.hex_string_to_bytes("0001") == Some(#"0001"),
    strings.hex_string_to_bytes("") == Some(#""),
    strings.hex_string_to_bytes("0") == None,
    strings.hex_string_to_bytes("0g") == None,
    strings.hex_string_to_bytes(#"ff30") == None,
  }
}

test migration_budget_hex_matches_independent_decoder(
  input via fuzz.tuple3(
    fuzz.bytearray_between(0, 128),
    fuzz.bytearray_between(0, 64),
    fuzz.bool(),
  ),
) {
  let (raw, bytes, valid) = input
  let text =
    if valid {
      hex_reference(bytes)
    } else {
      raw
    }
  let expected =
    reference_decode_hex(
      bytearray.foldr(text, [], fn(byte, rest) { [byte, ..rest] }),
    )
  fuzz.label(
    if valid {
      @"fuzz.unit.migration.hex.valid-values-and-lengths"
    } else {
      @"fuzz.unit.migration.hex.arbitrary-byte-inputs"
    },
  )
  strings.hex_string_to_bytes(text) == expected
}

test migration_budget_update_accepts_exact_witness() {
  let key = "witness-boundary"
  let siblings = list.repeat(zero, 64)
  let expected =
    reference_root(
      builtin.sha2_256(key),
      reference_leaf(builtin.sha2_256(key), "new"),
      siblings,
    )
  tree.apply_update(zero, key, "", "new", siblings) == expected
}

test migration_budget_update_rejects_short_witness() fail {
  expect _ =
    tree.apply_update(
      zero,
      "witness-boundary",
      "",
      "new",
      list.repeat(zero, 63),
    )
}

test migration_budget_update_rejects_long_witness() fail {
  // The old root is still the valid empty root. Rejection must come from the
  // 65th path bit, not an unrelated old-root mismatch.
  expect _ =
    tree.apply_update(
      zero,
      "witness-boundary",
      "",
      "new",
      list.repeat(zero, 65),
    )
}

test migration_budget_update_rejects_wrong_sibling_size() fail {
  let key = "witness-boundary"
  let siblings = [#"00", ..list.repeat(zero, 63)]
  // Supply the root of this malformed witness, so removing the size guard
  // actually accepts it. A zero root would also fail root authentication.
  let malformed_root = reference_root(builtin.sha2_256(key), zero, siblings)
  expect _ = tree.apply_update(malformed_root, key, "", "new", siblings)
}
