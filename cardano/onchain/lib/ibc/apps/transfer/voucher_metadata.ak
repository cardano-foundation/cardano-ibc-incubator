use aiken/builtin
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
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
  // One immutable two-character lookup per byte; exact lowercase CIP-68 hex.
  hex_ascii_go(bytes, bytearray.length(bytes) - 1, #"")
}

const lowercase_hex_pairs =
  #"3030303130323033303430353036303730383039306130623063306430653066313031313132313331343135313631373138313931613162316331643165316632303231323232333234323532363237323832393261326232633264326532663330333133323333333433353336333733383339336133623363336433653366343034313432343334343435343634373438343934613462346334643465346635303531353235333534353535363537353835393561356235633564356535663630363136323633363436353636363736383639366136623663366436653666373037313732373337343735373637373738373937613762376337643765376638303831383238333834383538363837383838393861386238633864386538663930393139323933393439353936393739383939396139623963396439653966613061316132613361346135613661376138613961616162616361646165616662306231623262336234623562366237623862396261626262636264626562666330633163326333633463356336633763386339636163626363636463656366643064316432643364346435643664376438643964616462646364646465646665306531653265336534653565366537653865396561656265636564656565666630663166326633663466356636663766386639666166626663666466656666"

fn hex_ascii_go(bytes: ByteArray, index: Int, acc: ByteArray) -> ByteArray {
  if index < 0 {
    acc
  } else {
    hex_ascii_go(
      bytes,
      index - 1,
      builtin.append_bytearray(
        builtin.slice_bytearray(
          2 * builtin.index_bytearray(bytes, index),
          2,
          lowercase_hex_pairs,
        ),
        acc,
      ),
    )
  }
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
