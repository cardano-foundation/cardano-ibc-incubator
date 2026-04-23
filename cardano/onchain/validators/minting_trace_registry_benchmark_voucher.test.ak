use cardano/assets.{PolicyId, add, from_asset}
use cardano/transaction.{Transaction}
use ibc/apps/transfer/voucher_asset_name
use minting_trace_registry_benchmark_voucher

fn test_policy_id() -> PolicyId {
  "trace registry benchmark voucher policy"
}

test trace_registry_benchmark_voucher_mint_succeeds_for_single_positive_28_byte_asset_name() {
  let token_name = voucher_asset_name.voucher_denom_hash("transfer/channel-7/benchmark-uatom")
  let mint = from_asset(test_policy_id(), token_name, 1)
  let transaction = Transaction { ..transaction.placeholder, mint }

  minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint(
    0,
    test_policy_id(),
    transaction,
  )
}

test trace_registry_benchmark_voucher_mint_fails_for_multiple_assets() fail {
  let token_name = voucher_asset_name.voucher_denom_hash("transfer/channel-7/benchmark-uatom")
  let second_token_name =
    voucher_asset_name.voucher_denom_hash("transfer/channel-8/benchmark-uosmo")
  let mint =
    from_asset(test_policy_id(), token_name, 1)
      |> add(test_policy_id(), second_token_name, 1)
  let transaction = Transaction { ..transaction.placeholder, mint }

  minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint(
    0,
    test_policy_id(),
    transaction,
  )
}

test trace_registry_benchmark_voucher_mint_fails_for_non_28_byte_asset_name() fail {
  let mint = from_asset(test_policy_id(), "not-a-voucher-hash", 1)
  let transaction = Transaction { ..transaction.placeholder, mint }

  minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint(
    0,
    test_policy_id(),
    transaction,
  )
}

test trace_registry_benchmark_voucher_mint_fails_for_non_positive_quantity() fail {
  let token_name = voucher_asset_name.voucher_denom_hash("transfer/channel-7/benchmark-uatom")
  let mint = from_asset(test_policy_id(), token_name, 0)
  let transaction = Transaction { ..transaction.placeholder, mint }

  minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint(
    0,
    test_policy_id(),
    transaction,
  )
}
