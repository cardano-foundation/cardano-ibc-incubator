use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, Value, add, from_asset}
use cardano/transaction.{
  Input, NoDatum, Output, OutputReference, Redeemer, Spend, Transaction,
}
use host_state_nft.{BurnFinal, MintInitial}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  FinalizeShutdown, Heartbeat, HostStateRedeemer,
}

fn test_policy_id() -> PolicyId {
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
}

fn test_nonce_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: 0,
  }
}

fn test_nonce_input() -> Input {
  Input(
    test_nonce_ref(),
    Output {
      address: Address(
        Script(#"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"),
        None,
      ),
      value: from_asset("nonce policy", "nonce", 1),
      datum: NoDatum,
      reference_script: None,
    },
  )
}

fn test_host_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
    output_index: 0,
  }
}

fn test_host_input() -> Input {
  Input(
    test_host_ref(),
    Output {
      address: Address(
        Script(#"e15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b370"),
        None,
      ),
      value: from_asset(test_policy_id(), host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  )
}

fn validate_final_burn(mint: Value, host_redeemer: HostStateRedeemer) -> Bool {
  let spend_redeemer: Redeemer = host_redeemer
  host_state_nft.host_state_nft.mint(
    test_nonce_ref(),
    BurnFinal,
    test_policy_id(),
    Transaction {
      ..transaction.placeholder,
      inputs: [test_host_input()],
      mint,
      redeemers: [Pair(Spend(test_host_ref()), spend_redeemer)],
    },
  )
}

test host_state_nft_mints_once_from_nonce() {
  host_state_nft.host_state_nft.mint(
    test_nonce_ref(),
    MintInitial,
    test_policy_id(),
    Transaction {
      ..transaction.placeholder,
      inputs: [test_nonce_input()],
      mint: from_asset(test_policy_id(), host_state_token_name, 1),
    },
  )
}

test host_state_nft_burns_exact_token() {
  validate_final_burn(
    from_asset(test_policy_id(), host_state_token_name, -1),
    FinalizeShutdown,
  )
}

test host_state_nft_burn_rejects_wrong_quantity() fail {
  validate_final_burn(
    from_asset(test_policy_id(), host_state_token_name, -2),
    FinalizeShutdown,
  )
}

test host_state_nft_burn_rejects_another_name_under_policy() fail {
  let mint =
    from_asset(test_policy_id(), host_state_token_name, -1)
      |> add(test_policy_id(), "another-token", -1)
  validate_final_burn(mint, FinalizeShutdown)
}

test host_state_nft_burn_rejects_missing_host_state_input() fail {
  host_state_nft.host_state_nft.mint(
    test_nonce_ref(),
    BurnFinal,
    test_policy_id(),
    Transaction {
      ..transaction.placeholder,
      mint: from_asset(test_policy_id(), host_state_token_name, -1),
    },
  )
}

test host_state_nft_burn_rejects_non_final_host_state_redeemer() fail {
  validate_final_burn(
    from_asset(test_policy_id(), host_state_token_name, -1),
    Heartbeat,
  )
}

test host_state_nft_initial_mint_rejects_burn_quantity() fail {
  host_state_nft.host_state_nft.mint(
    test_nonce_ref(),
    MintInitial,
    test_policy_id(),
    Transaction {
      ..transaction.placeholder,
      inputs: [test_nonce_input()],
      mint: from_asset(test_policy_id(), host_state_token_name, -1),
    },
  )
}
