use aiken/builtin
use aiken/collection/list
use aiken/fuzz
use aiken/primitive/bytearray
use cardano/address
use cardano/assets
use cardano/transaction.{NoDatum, Output}
use ibc/auth.{AuthToken}
use ibc/native_value

const policy = #"11111111111111111111111111111111111111111111111111111111"

fn value(quantities: List<Int>) -> assets.Value {
  quantities
    |> list.indexed_map(
        fn(index, quantity) {
          (bytearray.from_int_big_endian(index, 1), quantity)
        },
      )
    |> list.foldl(
        assets.from_lovelace(2_000_000),
        fn(entry, acc) { assets.add(acc, policy, entry.1st, entry.2nd) },
      )
}

test native_value_preserves_encoding_and_quantities(
  quantities via fuzz.list_between(fuzz.int_between(-1000000, 1000000), 0, 16),
) {
  fuzz.label(@"fuzz.unit.native_value.encoding_and_quantities")
  let original = value(quantities)
  let native = native_value.from_assets(original)
  let raw: Data = assets.to_dict(original)
  and {
    builtin.value_data(native) == raw,
    builtin.lookup_value("", "", native) == 2_000_000,
    builtin.lookup_value(policy, #"ff", native) == 0,
    list.all(
      list.indexed_map(
        quantities,
        fn(index, quantity) {
          builtin.lookup_value(
            policy,
            bytearray.from_int_big_endian(index, 1),
            native,
          ) == quantity
        },
      ),
      fn(result) { result },
    ),
  }
}

test native_value_exact_assets_match_the_existing_rule(
  quantities via fuzz.list_between(fuzz.int_between(-1000000, 1000000), 0, 16),
) {
  fuzz.label(@"fuzz.unit.native_value.exact_assets")
  let original = value(quantities)
  let different_ada = assets.add(original, "", "", 1_000_000)
  let extra_asset = assets.add(original, policy, #"ff", 1)
  let native = native_value.from_assets(original)
  and {
    native_value.match(native, native_value.from_assets(different_ada)) == assets.match_assets(
      original,
      different_ada,
    ),
    native_value.match(native, native_value.from_assets(extra_asset)) == assets.match_assets(
      original,
      extra_asset,
    ),
    native_value.match(native, native_value.zero(native)) == assets.match_assets(
      original,
      assets.zero,
    ),
  }
}

test native_auth_tokens_keep_exact_quantities_and_reject_extra_assets() {
  let token = AuthToken { policy_id: policy, name: #"aa" }
  let output =
    Output {
      address: address.from_script(policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(policy, #"aa", 1),
      datum: NoDatum,
      reference_script: None,
    }
  and {
    auth.contain_auth_token(output, token),
    auth.contains_only_auth_tokens(output, [token]),
    !auth.contains_only_auth_tokens(output, [token, token]),
    auth.contains_only_auth_tokens(
      Output { ..output, value: assets.add(output.value, policy, #"aa", 1) },
      [token, token],
    ),
    !auth.contain_auth_token(
      Output { ..output, value: assets.add(output.value, policy, #"aa", 1) },
      token,
    ),
    !auth.contains_only_auth_tokens(
      Output { ..output, value: assets.add(output.value, policy, #"bb", 1) },
      [token],
    ),
  }
}
