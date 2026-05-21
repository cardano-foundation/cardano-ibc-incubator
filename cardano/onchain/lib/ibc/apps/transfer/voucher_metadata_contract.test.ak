use aiken/builtin
use aiken/crypto
use aiken/fuzz
use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/assets.{AssetName, PolicyId, Value, add, from_asset}
use ibc/apps/transfer/voucher_asset_name
use ibc/apps/transfer/voucher_metadata
use ibc/testing/fuzz_dsl

const full_denom = "transfer/channel-99/ibc/usdt"

const voucher_policy_id = "mint voucher policy id"

const wrong_voucher_policy_id = "wrong voucher policy id"

const transfer_amount = 100

fn user_token_name() -> AssetName {
  voucher_asset_name.voucher_user_token_name(full_denom)
}

fn reference_token_name() -> AssetName {
  voucher_asset_name.voucher_reference_token_name(full_denom)
}

fn wrong_reference_token_name() -> AssetName {
  voucher_asset_name.voucher_reference_token_name(
    "transfer/channel-404/ibc/usdt",
  )
}

fn canonical_metadata() -> Data {
  voucher_metadata.build_datum(full_denom, user_token_name(), voucher_policy_id)
}

fn description(denom: ByteArray) -> ByteArray {
  bytearray.concat("IBC voucher for ", denom)
}

fn hex_ascii(bytes: ByteArray) -> ByteArray {
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

fn metadata_datum(
  name: ByteArray,
  ticker: ByteArray,
  description: ByteArray,
  full_denom: ByteArray,
  voucher_policy_id: PolicyId,
  voucher_token_name: AssetName,
) -> Data {
  let metadata_map =
    builtin.map_data(
      [
        Pair(builtin.b_data("name"), builtin.b_data(name)),
        Pair(builtin.b_data("ticker"), builtin.b_data(ticker)),
        Pair(builtin.b_data("description"), builtin.b_data(description)),
      ],
    )
  let extra_map =
    builtin.map_data(
      [
        Pair(builtin.b_data("path"), builtin.b_data("transfer/channel-99/ibc")),
        Pair(builtin.b_data("baseDenom"), builtin.b_data("usdt")),
        Pair(builtin.b_data("fullDenom"), builtin.b_data(full_denom)),
        Pair(
          builtin.b_data("ibcDenomHash"),
          builtin.b_data(
            crypto.sha2_256(full_denom)
              |> hex_ascii,
          ),
        ),
        Pair(builtin.b_data("traceVersion"), builtin.i_data(1)),
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

  builtin.constr_data(0, [metadata_map, builtin.i_data(1), extra_map])
}

fn valid_first_mint_metadata(
  metadata_datum: Data,
  metadata_policy_id: PolicyId,
  metadata_reference_token_name: AssetName,
) -> Bool {
  and {
    metadata_policy_id == voucher_policy_id,
    metadata_reference_token_name == reference_token_name(),
    metadata_datum == canonical_metadata(),
  }
}

fn existing_mapping_mint_is_valid(mint: Value) -> Bool {
  let expected =
    from_asset(voucher_policy_id, user_token_name(), transfer_amount)
  assets.match_assets(mint, expected)
}

test prop_voucher_first_mint_accepts_valid_metadata(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.valid_metadata")

  fuzz_dsl.valid_check(
    "voucher",
    "first_mint",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      canonical_metadata(),
      voucher_policy_id,
      reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_voucher_first_mint_rejects_wrong_name(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.invalid_wrong_name")

  fuzz_dsl.mutated_check(
    "voucher",
    "first_mint",
    "wrong_name",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      metadata_datum(
        "fake-usdt",
        "usdt",
        description(full_denom),
        full_denom,
        voucher_policy_id,
        user_token_name(),
      ),
      voucher_policy_id,
      reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_voucher_first_mint_rejects_wrong_ticker(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.invalid_wrong_ticker")

  fuzz_dsl.mutated_check(
    "voucher",
    "first_mint",
    "wrong_ticker",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      metadata_datum(
        "usdt",
        "FAKE",
        description(full_denom),
        full_denom,
        voucher_policy_id,
        user_token_name(),
      ),
      voucher_policy_id,
      reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_voucher_first_mint_rejects_wrong_description(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.invalid_wrong_description")

  fuzz_dsl.mutated_check(
    "voucher",
    "first_mint",
    "wrong_description",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      metadata_datum(
        "usdt",
        "usdt",
        "not the real denom trace",
        full_denom,
        voucher_policy_id,
        user_token_name(),
      ),
      voucher_policy_id,
      reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_voucher_first_mint_rejects_wrong_full_denom(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.invalid_wrong_full_denom")

  fuzz_dsl.mutated_check(
    "voucher",
    "first_mint",
    "wrong_full_denom",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      metadata_datum(
        "usdt",
        "usdt",
        description("transfer/channel-404/ibc/usdt"),
        "transfer/channel-404/ibc/usdt",
        voucher_policy_id,
        user_token_name(),
      ),
      voucher_policy_id,
      reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_voucher_first_mint_rejects_wrong_policy(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.invalid_wrong_policy")

  fuzz_dsl.mutated_check(
    "voucher",
    "first_mint",
    "wrong_policy",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      metadata_datum(
        "usdt",
        "usdt",
        description(full_denom),
        full_denom,
        wrong_voucher_policy_id,
        user_token_name(),
      ),
      voucher_policy_id,
      reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_voucher_first_mint_rejects_wrong_reference_asset(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.first_mint.invalid_wrong_reference_asset")

  fuzz_dsl.mutated_check(
    "voucher",
    "first_mint",
    "wrong_reference_asset",
    "valid_first_mint_metadata",
    valid_first_mint_metadata(
      canonical_metadata(),
      voucher_policy_id,
      wrong_reference_token_name(),
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_voucher_existing_mint_rejects_reference_nft(_seed via fuzz.int()) {
  fuzz.label(@"contract.voucher.existing_mint.rejects_reference_nft")

  let mint =
    from_asset(voucher_policy_id, user_token_name(), transfer_amount)
      |> add(voucher_policy_id, reference_token_name(), 1)

  fuzz_dsl.mutated_check(
    "voucher",
    "existing_mint",
    "reference_nft",
    "existing_mapping_mint_is_valid",
    existing_mapping_mint_is_valid(mint),
  )
    |> fuzz_dsl.assert_rejected
}
