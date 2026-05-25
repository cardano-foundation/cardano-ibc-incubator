use aiken/crypto.{VerificationKeyHash}
use aiken/fuzz
use bridge_registry as bridge_registry_validator
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use ibc/apps/transfer/bridge_registry.{BridgeDeployment, BridgeRegistryDatum}
use ibc/auth.{AuthToken}

const governance_key_hash: VerificationKeyHash =
  #"00000000000000000000000000000000000000000000000000000000"

const wrong_governance_key_hash: VerificationKeyHash =
  #"11111111111111111111111111111111111111111111111111111111"

fn registry_token() -> AuthToken {
  AuthToken {
    policy_id: "bridge registry policy",
    name: "bridge registry token",
  }
}

fn datum(
  active_voucher_policy_id: PolicyId,
  legacy_voucher_policy_ids: List<PolicyId>,
) -> BridgeRegistryDatum {
  BridgeRegistryDatum {
    active_deployment: BridgeDeployment {
      host_state_nft_policy_id: "host state policy",
      channel_minting_policy_id: "channel policy",
    },
    active_voucher_policy_id,
    legacy_voucher_policy_ids,
    governance_key_hash,
  }
}

fn registry_output(datum: BridgeRegistryDatum) -> Output {
  let token = registry_token()

  Output {
    address: from_script("bridge registry script hash"),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn registry_input(datum: BridgeRegistryDatum) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"50b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    },
    output: registry_output(datum),
  }
}

fn run_registry_update(
  input_datum: BridgeRegistryDatum,
  output_datum: BridgeRegistryDatum,
) -> Bool {
  run_registry_update_signed_by(input_datum, output_datum, governance_key_hash)
}

fn run_registry_update_signed_by(
  input_datum: BridgeRegistryDatum,
  output_datum: BridgeRegistryDatum,
  signer: VerificationKeyHash,
) -> Bool {
  let input = registry_input(input_datum)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [registry_output(output_datum)],
      extra_signatories: [signer],
    }

  bridge_registry_validator.bridge_registry.spend(
    registry_token(),
    None,
    bridge_registry_validator.UpdateBridgeRegistry,
    input.output_reference,
    transaction,
  )
}

test prop_tx_bridge_registry_update_accepts_active_rotation(
  _seed via fuzz.int(),
) {
  fuzz.label(
    @"regression.tx.bridge_registry.update.valid_active_rotates_to_legacy",
  )

  // tx.* depth: this executes the real bridge_registry spending validator with
  // the registry token, input datum, continuing output, and governance signer.
  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      ["old active voucher policy", "legacy voucher policy"],
    ),
  )
}

test prop_tx_bridge_registry_update_rejects_dropped_old_active(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.bridge_registry.update.invalid_drops_old_active")

  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum("new active voucher policy", ["legacy voucher policy"]),
  )
}

test prop_tx_bridge_registry_update_rejects_dropped_old_legacy(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.bridge_registry.update.invalid_drops_old_legacy")

  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum("new active voucher policy", ["old active voucher policy"]),
  )
}

test prop_tx_bridge_registry_update_rejects_active_in_legacy(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.bridge_registry.update.invalid_active_in_legacy")

  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      [
        "old active voucher policy", "legacy voucher policy",
        "new active voucher policy",
      ],
    ),
  )
}

test prop_tx_bridge_registry_update_rejects_duplicate_legacy(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.bridge_registry.update.invalid_duplicate_legacy")

  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      [
        "old active voucher policy", "legacy voucher policy",
        "legacy voucher policy",
      ],
    ),
  )
}

test prop_tx_bridge_registry_update_rejects_wrong_governance_key(
  _seed via fuzz.int(),
) fail {
  fuzz.label(
    @"regression.tx.bridge_registry.update.invalid_wrong_governance_key",
  )

  run_registry_update_signed_by(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      ["old active voucher policy", "legacy voucher policy"],
    ),
    wrong_governance_key_hash,
  )
}

test update_succeeds_when_old_active_becomes_legacy() {
  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      ["old active voucher policy", "legacy voucher policy"],
    ),
  )
}

test update_fails_when_old_active_is_not_legacy() fail {
  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum("new active voucher policy", ["legacy voucher policy"]),
  )
}

test update_fails_when_existing_legacy_policy_is_removed() fail {
  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum("new active voucher policy", ["old active voucher policy"]),
  )
}

test update_fails_when_new_active_is_also_legacy() fail {
  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      [
        "old active voucher policy", "legacy voucher policy",
        "new active voucher policy",
      ],
    ),
  )
}

test update_fails_when_legacy_policy_list_has_duplicates() fail {
  run_registry_update(
    datum("old active voucher policy", ["legacy voucher policy"]),
    datum(
      "new active voucher policy",
      [
        "old active voucher policy", "legacy voucher policy",
        "legacy voucher policy",
      ],
    ),
  )
}
