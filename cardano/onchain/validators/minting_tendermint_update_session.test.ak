use aiken/collection/list
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset, quantity_of, zero}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  BurnSession, CommitCore, MintSession, MintSessionRedeemer, SessionDatum,
  UpdatePlan,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle
use minting_tendermint_update_session

const validator_root =
  #"1111111111111111111111111111111111111111111111111111111111111111"

fn output_ref(byte: ByteArray, index: Int) -> OutputReference {
  OutputReference { transaction_id: byte, output_index: index }
}

fn plan() -> UpdatePlan {
  let header =
    TmHeader {
      ..tm_header_mod.null_tm_header(),
      version: Consensus { block: block_protocol, app: 0 },
      chain_id: "chain-0",
      height: 11,
      time: 1_500_000_000,
      validators_hash: validator_root,
      next_validators_hash: validator_root,
      app_hash: #"2222222222222222222222222222222222222222222222222222222222222222",
    }
  UpdatePlan {
    client_token: AuthToken {
      policy_id: #"33333333333333333333333333333333333333333333333333333333",
      name: "08-tendermint-0",
    },
    trusted_height: Height { revision_number: 0, revision_height: 10 },
    trusted_consensus_state: ConsensusState {
      timestamp: 1_000_000_000,
      next_validators_hash: validator_root,
      root: merkle.new_merkle_root(#"44"),
    },
    trust_level: unchecked_rational.new(1, 3),
    trusting_period: 10_000_000_000,
    max_clock_drift: 1_000_000_000,
    header,
    commit: CommitCore {
      height: header.height,
      round: 0,
      block_id: BlockID {
        hash: tm_header_mod.hash(header),
        part_set_header: PartSetHeader { total: 1, hash: validator_root },
      },
    },
    target_validator_count: 1,
    trusted_validator_count: 0,
  }
}

fn seed_input(seed: OutputReference) -> Input {
  Input {
    output_reference: seed,
    output: Output {
      address: from_script(
        #"55555555555555555555555555555555555555555555555555555555",
      ),
      value: zero,
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn mint_context() -> (ByteArray, MintSessionRedeemer, PolicyId, Transaction) {
  let own_policy_id: PolicyId =
    #"66666666666666666666666666666666666666666666666666666666"
  let session_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"
  let seed =
    output_ref(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      0,
    )
  let owner = #"99999999999999999999999999999999999999999999999999999999"
  let update_plan = plan()
  let token =
    AuthToken {
      policy_id: own_policy_id,
      name: session.session_token_name(seed, update_plan),
    }
  let output =
    Output {
      address: from_script(session_script_hash),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(session.initial_datum(token, owner, update_plan)),
      reference_script: None,
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input(seed)],
      outputs: [output],
      mint: from_asset(token.policy_id, token.name, 1),
      extra_signatories: [owner],
    }

  (
    session_script_hash,
    MintSession { seed, owner, plan: update_plan },
    own_policy_id,
    transaction,
  )
}

fn session_mint_fixture_is_constructed(
  session_script_hash: ByteArray,
  redeemer: MintSessionRedeemer,
  own_policy_id: PolicyId,
  transaction: Transaction,
) -> Bool {
  expect MintSession { seed, owner, plan: update_plan } = redeemer
  expect [input] = transaction.inputs
  expect [output] = transaction.outputs
  let token =
    AuthToken {
      policy_id: own_policy_id,
      name: session.session_token_name(seed, update_plan),
    }
  and {
    session_script_hash != #"",
    input.output_reference == seed,
    list.has(transaction.extra_signatories, owner),
    quantity_of(transaction.mint, own_policy_id, token.name) == 1,
    output.address == from_script(session_script_hash),
    output.value == from_asset(token.policy_id, token.name, 1),
    output.datum == InlineDatum(
      session.initial_datum(token, owner, update_plan),
    ),
  }
}

test session_mint_fixture_setup_baseline() {
  let (session_script_hash, redeemer, own_policy_id, transaction) =
    mint_context()
  session_mint_fixture_is_constructed(
    session_script_hash,
    redeemer,
    own_policy_id,
    transaction,
  )
}

test mints_one_seed_bound_session_with_exact_initial_datum() {
  let (session_script_hash, redeemer, own_policy_id, transaction) =
    mint_context()
  expect
    session_mint_fixture_is_constructed(
      session_script_hash,
      redeemer,
      own_policy_id,
      transaction,
    )

  minting_tendermint_update_session.mint_tendermint_update_session.mint(
    session_script_hash,
    redeemer,
    own_policy_id,
    transaction,
  )
}

test rejects_session_mint_without_owner_signature() fail {
  let own_policy_id: PolicyId =
    #"66666666666666666666666666666666666666666666666666666666"
  let session_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"
  let seed =
    output_ref(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      0,
    )
  let owner = #"99999999999999999999999999999999999999999999999999999999"
  let update_plan = plan()
  let token =
    AuthToken {
      policy_id: own_policy_id,
      name: session.session_token_name(seed, update_plan),
    }
  let output =
    Output {
      address: from_script(session_script_hash),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(session.initial_datum(token, owner, update_plan)),
      reference_script: None,
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input(seed)],
      outputs: [output],
      mint: from_asset(token.policy_id, token.name, 1),
    }

  minting_tendermint_update_session.mint_tendermint_update_session.mint(
    session_script_hash,
    MintSession { seed, owner, plan: update_plan },
    own_policy_id,
    transaction,
  )
}

test rejects_session_mint_with_wrong_owner_signature() fail {
  let own_policy_id: PolicyId =
    #"66666666666666666666666666666666666666666666666666666666"
  let session_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"
  let seed =
    output_ref(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      0,
    )
  let owner = #"99999999999999999999999999999999999999999999999999999999"
  let update_plan = plan()
  let token =
    AuthToken {
      policy_id: own_policy_id,
      name: session.session_token_name(seed, update_plan),
    }
  let output =
    Output {
      address: from_script(session_script_hash),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(session.initial_datum(token, owner, update_plan)),
      reference_script: None,
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input(seed)],
      outputs: [output],
      mint: from_asset(token.policy_id, token.name, 1),
      extra_signatories: [
        #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
    }

  minting_tendermint_update_session.mint_tendermint_update_session.mint(
    session_script_hash,
    MintSession { seed, owner, plan: update_plan },
    own_policy_id,
    transaction,
  )
}

test rejects_non_initial_session_datum() fail {
  let own_policy_id: PolicyId =
    #"66666666666666666666666666666666666666666666666666666666"
  let session_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"
  let seed =
    output_ref(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      0,
    )
  let owner = #"99999999999999999999999999999999999999999999999999999999"
  let update_plan = plan()
  let token =
    AuthToken {
      policy_id: own_policy_id,
      name: session.session_token_name(seed, update_plan),
    }
  let initial = session.initial_datum(token, owner, update_plan)
  let forged =
    SessionDatum {
      ..initial,
      owner: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
  let output =
    Output {
      address: from_script(session_script_hash),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(forged),
      reference_script: None,
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input(seed)],
      outputs: [output],
      mint: from_asset(token.policy_id, token.name, 1),
      extra_signatories: [owner],
    }

  minting_tendermint_update_session.mint_tendermint_update_session.mint(
    session_script_hash,
    MintSession { seed, owner, plan: update_plan },
    own_policy_id,
    transaction,
  )
}

fn burn_context() -> (ByteArray, AuthToken, PolicyId, Transaction) {
  let own_policy_id: PolicyId =
    #"66666666666666666666666666666666666666666666666666666666"
  let session_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"
  let seed =
    output_ref(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      0,
    )
  let update_plan = plan()
  let token =
    AuthToken {
      policy_id: own_policy_id,
      name: session.session_token_name(seed, update_plan),
    }
  let datum =
    session.initial_datum(
      token,
      #"99999999999999999999999999999999999999999999999999999999",
      update_plan,
    )
  let input =
    Input {
      output_reference: seed,
      output: Output {
        address: from_script(session_script_hash),
        value: from_asset(token.policy_id, token.name, 1),
        datum: InlineDatum(datum),
        reference_script: None,
      },
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      mint: from_asset(token.policy_id, token.name, -1),
    }

  (session_script_hash, token, own_policy_id, transaction)
}

fn session_burn_fixture_is_constructed(
  session_script_hash: ByteArray,
  token: AuthToken,
  own_policy_id: PolicyId,
  transaction: Transaction,
) -> Bool {
  expect [input] = transaction.inputs
  and {
    session_script_hash != #"",
    token.policy_id == own_policy_id,
    input.output_reference.output_index == 0,
  }
}

test session_burn_fixture_setup_baseline() {
  let (session_script_hash, token, own_policy_id, transaction) = burn_context()
  session_burn_fixture_is_constructed(
    session_script_hash,
    token,
    own_policy_id,
    transaction,
  )
}

test burns_only_a_token_carried_by_the_session_script() {
  let (session_script_hash, token, own_policy_id, transaction) = burn_context()
  expect
    session_burn_fixture_is_constructed(
      session_script_hash,
      token,
      own_policy_id,
      transaction,
    )

  minting_tendermint_update_session.mint_tendermint_update_session.mint(
    session_script_hash,
    BurnSession { token_name: token.name },
    own_policy_id,
    transaction,
  )
}
