use aiken/builtin
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/assets.{AssetName, PolicyId}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/utils/string as string_utils

pub const voucher_metadata_version = 1

pub type DenomTrace {
  DenomTrace { path: ByteArray, base_denom: ByteArray }
}

pub fn build_datum(
  full_denom: ByteArray,
  voucher_token_name: AssetName,
  voucher_policy_id: PolicyId,
) -> Data {
  let denom_trace = split_full_denom_trace(full_denom)
  let label = canonical_label(denom_trace.base_denom)

  // CIP-68 user-facing metadata; derived on-chain, not relayer-provided.
  let metadata_map =
    builtin.map_data(
      [
        Pair(builtin.b_data("name"), builtin.b_data(label)),
        Pair(builtin.b_data("ticker"), builtin.b_data(label)),
        Pair(
          builtin.b_data("description"),
          builtin.b_data(description(full_denom)),
        ),
      ],
    )

  // Non-display fields used by off-chain clients to verify this datum matches the voucher.
  let extra_map =
    builtin.map_data(
      [
        Pair(builtin.b_data("path"), builtin.b_data(denom_trace.path)),
        Pair(
          builtin.b_data("baseDenom"),
          builtin.b_data(denom_trace.base_denom),
        ),
        Pair(builtin.b_data("fullDenom"), builtin.b_data(full_denom)),
        Pair(
          builtin.b_data("ibcDenomHash"),
          builtin.b_data(ibc_denom_hash(full_denom)),
        ),
        Pair(
          builtin.b_data("traceVersion"),
          builtin.i_data(voucher_metadata_version),
        ),
        Pair(
          builtin.b_data("voucherPolicyId"),
          builtin.b_data(hex_ascii(voucher_policy_id)),
        ),
        Pair(
          builtin.b_data("voucherTokenName"),
          builtin.b_data(hex_ascii(voucher_token_name)),
        ),
      ],
    )

  builtin.constr_data(
    0,
    [metadata_map, builtin.i_data(voucher_metadata_version), extra_map],
  )
}

pub fn split_full_denom_trace(full_denom: ByteArray) -> DenomTrace {
  // Parse leading port/channel pairs; the remaining suffix is the base denom.
  let normalized = string_utils.trim_space(full_denom)
  expect normalized != ""

  let segments = string_utils.split(normalized, string_utils.slash_char)
  expect !list.any(segments, fn(segment) { segment == "" })

  do_split_full_denom_trace(segments, [])
}

fn do_split_full_denom_trace(
  segments: List<ByteArray>,
  reversed_path_segments: List<ByteArray>,
) -> DenomTrace {
  when segments is {
    [] -> fail @"Denom trace is missing base denomination"
    [base_denom] ->
      DenomTrace {
        path: join_segments(list.reverse(reversed_path_segments)),
        base_denom,
      }
    [maybe_port, maybe_channel, ..rest] ->
      if chan_keys_mod.is_valid_channel_id(maybe_channel) {
        do_split_full_denom_trace(
          rest,
          [maybe_channel, maybe_port, ..reversed_path_segments],
        )
      } else {
        DenomTrace {
          path: join_segments(list.reverse(reversed_path_segments)),
          base_denom: join_segments([maybe_port, maybe_channel, ..rest]),
        }
      }
  }
}

fn canonical_label(base_denom: ByteArray) -> ByteArray {
  // For now, name/ticker are the final slash-separated base-denom segment.
  let trimmed = string_utils.trim_space(base_denom)
  if trimmed == "" {
    "IBC"
  } else {
    string_utils.split(trimmed, string_utils.slash_char)
      |> list.foldl(
          "IBC",
          fn(segment, current) {
            if segment == "" {
              current
            } else {
              segment
            }
          },
        )
  }
}

fn description(full_denom: ByteArray) -> ByteArray {
  bytearray.concat("IBC voucher for ", full_denom)
}

fn ibc_denom_hash(full_denom: ByteArray) -> ByteArray {
  // ICS-20 hash for off-chain verification; distinct from the CIP-68 name hash.
  crypto.sha2_256(full_denom)
    |> hex_ascii
}

fn hex_ascii(bytes: ByteArray) -> ByteArray {
  // Match the TypeScript encoder's lowercase ASCII hex representation.
  bytes
    |> bytearray.to_hex
    |> string.to_bytearray
    |> ascii_lower
}

fn ascii_lower(bytes: ByteArray) -> ByteArray {
  bytearray.foldr(
    bytes,
    "",
    fn(byte, acc) {
      bytearray.push(
        acc,
        if byte >= 65 && byte <= 90 {
          byte + 32
        } else {
          byte
        },
      )
    },
  )
}

fn join_segments(segments: List<ByteArray>) -> ByteArray {
  list.foldl(
    segments,
    "",
    fn(segment, acc) {
      if acc == "" {
        segment
      } else {
        bytearray.concat(bytearray.concat(acc, "/"), segment)
      }
    },
  )
}
