use aiken/interval
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, ScriptContext, Spend, Transaction,
  TransactionId,
}
use aiken/transaction/credential
use aiken/transaction/value
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  Other, SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
} as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle as misbehaviour_handle_mod
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/update as update_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_023_vector_commitments/merkle
use ibc/utils/tx_time.{TxTime} as tx_time_mod
use ibc/utils/validator_utils

validator {
  fn spend_client(
    datum: ClientDatum,
    redeemer: SpendClientRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction { outputs, validity_range, .. } = transaction

    //========================valid input=======================
    // input contains client token
    expect spent_output |> auth.contain_auth_token(datum.token)

    //========================valid output=======================
    expect [updated_output] =
      outputs
        |> list.filter(fn(output) { output.address == spent_output.address })

    // output contains client token
    expect updated_output |> auth.contain_auth_token(datum.token)

    // TODO: add verify header
    // output datum is updated correctly
    expect updated_datum: ClientDatum =
      validator_utils.get_inline_datum(updated_output)
    when redeemer is {
      UpdateClient { msg } -> {
        trace @"spend_client: UpdateClient branch"

        let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

        expect Some(tx_valid_from) =
          validator_utils.get_tx_valid_from(validity_range)

        expect
          client_state_mod.status(
            datum.state.client_state,
            tx_valid_to * 1_000_000,
            datum.state.consensus_states,
          ) == client_status_mod.Active
        trace @"spend_client: client status is Active"

        let tx_time =
          TxTime {
            valid_from: tx_valid_from * 1_000_000,
            valid_to: tx_valid_to * 1_000_000,
          }
        expect
          update_mod.verify_client_message(
            datum.state.client_state,
            tx_time,
            datum.state.consensus_states,
            msg,
          )
        trace @"spend_client: verify client msg succeeded"

        let found_misbehaviour =
          misbehaviour_handle_mod.check_for_misbehaviour(
            msg,
            datum.state.consensus_states,
          )

        if found_misbehaviour {
          trace @"spend_client: found misbehaviour"
          expect
            client_datum_mod.update_state_on_misbehaviour(datum, updated_datum)
          trace @"spend_client: update client misbehaviour succeeded"
          True
        } else {
          expect HeaderCase(header) = msg

          expect
            client_datum_mod.update_state(
              datum,
              updated_datum,
              header,
              tx_valid_from,
            )

          True
        }
      }

      Other -> False
    }
  }
}

//======================================Test====================================

type MockData {
  client_token: AuthToken,
  output_reference: OutputReference,
  input: Input,
}

fn setup() -> MockData {
  let client_token =
    AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let output_reference =
    OutputReference {
      transaction_id: TransactionId("client tx hash"),
      output_index: 0,
    }

  let spend_client_script_hash = "mock spend_client_script_hash"

  let spent_output =
    Output {
      address: credential.from_script(spend_client_script_hash),
      value: value.from_asset(client_token.policy_id, client_token.name, 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let input = Input { output_reference, output: spent_output }

  MockData { client_token, input, output_reference }
}

fn update_client_output_datum(
  client_datum: ClientDatum,
  output: Output,
) -> Output {
  let client_output = Output { ..output, datum: InlineDatum(client_datum) }

  client_output
}

fn update_client_input_datum(client_datum: ClientDatum, input: Input) -> Input {
  let client_input =
    Input {
      ..input,
      output: update_client_output_datum(client_datum, input.output),
    }

  client_input
}

test update_client_misbehaviour_conflict_header() {
  let mock = setup()

  let signed_header =
    SignedHeader {
      header: TmHeader {
        version: Consensus { block: block_protocol, app: 2 },
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        last_block_id: BlockID {
          hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          part_set_header: PartSetHeader {
            total: 10000,
            hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
        last_commit_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        data_hash: #"6d6e28b8b98b5327042ea50a57dd46e6cc851c72e528bdeaa6efdeeefe66a0b8",
        validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        consensus_hash: #"e5e566c41ed57e3ff8cc10f184178788b8faa602b07cf1f425217bd8179f1f24",
        app_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        last_results_hash: #"092e058630247ed6009863a12eee117d26cd9d08b5adcaab37f2ab35db475a37",
        evidence_hash: #"73865db08f49d58428905d389ab4ca4b96e45a3206c7a69d43a5dc7372e60714",
        proposer_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
            timestamp: 1577836805000000000,
            signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
            timestamp: 1577836805000000000,
            signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
            timestamp: 1577836805000000000,
            signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
            timestamp: 1577836805000000000,
            signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let header =
    Header {
      signed_header,
      validator_set,
      trusted_height: Height { revision_number: 1, revision_height: 1 },
      trusted_validators,
    }

  //======================Arrange datum============================
  let trust_level = unchecked_rational.new(1, 3)

  let trusted_height = Height { revision_number: 1, revision_height: 1 }

  let client_state =
    ClientState {
      chain_id: "testchain2-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: trusted_height,
      proof_specs: [],
    }

  let consensus_state =
    ConsensusState {
      timestamp: 157783680000000000,
      next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
      root: merkle.new_merkle_root(#""),
    }

  let conflicted_consensus_state =
    ConsensusState {
      timestamp: 157783680000000000,
      next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
      root: merkle.new_merkle_root("conflicting apphash"),
    }

  let conflicted_height = header_mod.get_height(header)

  let consensus_states =
    [
      Pair(trusted_height, consensus_state),
      Pair(conflicted_height, conflicted_consensus_state),
    ]

  let client_datum =
    ClientDatum {
      state: ClientDatumState { client_state, consensus_states },
      token: mock.client_token,
    }

  //======================Arrange redeemer============================
  let redeemer = UpdateClient { msg: HeaderCase(header) }

  //====================Arrange inputs==============================
  let client_input = update_client_input_datum(client_datum, mock.input)

  let inputs =
    [client_input]

  //===================Arrange outputs===================================
  let updated_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        ..client_datum.state,
        client_state: ClientState {
          ..client_datum.state.client_state,
          frozen_height: Height { revision_number: 0, revision_height: 1 },
        },
      },
    }

  let updated_output =
    update_client_output_datum(updated_datum, client_input.output)

  let outputs =
    [updated_output]

  //====================Arrange validity_range ==============================
  let validity_range =
    interval.between(
      ( header.signed_header.header.time - client_state.max_clock_drift ) / 1_000_000 + 1000,
      ( consensus_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1000,
    )

  //=======================Arrange context ==============================
  let purpose = Spend(mock.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      validity_range: validity_range,
    }

  let context = ScriptContext { purpose, transaction }

  spend_client(client_datum, redeemer, context)
}

test update_client_misbehaviour_monotonic_time_violation() {
  let mock = setup()

  let trusted_height = Height { revision_number: 1, revision_height: 1 }

  let signed_header =
    SignedHeader {
      header: TmHeader {
        version: Consensus { block: block_protocol, app: 2 },
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        last_block_id: BlockID {
          hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          part_set_header: PartSetHeader {
            total: 10000,
            hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
        last_commit_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        data_hash: #"6d6e28b8b98b5327042ea50a57dd46e6cc851c72e528bdeaa6efdeeefe66a0b8",
        validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        consensus_hash: #"e5e566c41ed57e3ff8cc10f184178788b8faa602b07cf1f425217bd8179f1f24",
        app_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        last_results_hash: #"092e058630247ed6009863a12eee117d26cd9d08b5adcaab37f2ab35db475a37",
        evidence_hash: #"73865db08f49d58428905d389ab4ca4b96e45a3206c7a69d43a5dc7372e60714",
        proposer_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
            timestamp: 1577836805000000000,
            signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
            timestamp: 1577836805000000000,
            signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
            timestamp: 1577836805000000000,
            signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
            timestamp: 1577836805000000000,
            signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let header =
    Header { signed_header, validator_set, trusted_height, trusted_validators }

  //======================Arrange datum============================
  let trust_level = unchecked_rational.new(1, 3)

  let prev_height = Height { revision_number: 1, revision_height: 2 }

  let client_state =
    ClientState {
      chain_id: "testchain2-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: prev_height,
      proof_specs: [],
    }

  let consensus_state =
    ConsensusState {
      timestamp: 157783680000000000,
      next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
      root: merkle.new_merkle_root(#""),
    }

  let after_header_timestamp = signed_header.header.time + 1

  let prev_consensus_state =
    ConsensusState {
      timestamp: after_header_timestamp,
      next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
      root: merkle.new_merkle_root("fake apphash"),
    }

  let consensus_states =
    [
      Pair(trusted_height, consensus_state),
      Pair(prev_height, prev_consensus_state),
    ]

  let client_datum =
    ClientDatum {
      state: ClientDatumState { client_state, consensus_states },
      token: mock.client_token,
    }

  //======================Arrange redeemer============================
  let redeemer = UpdateClient { msg: HeaderCase(header) }

  //====================Arrange inputs==============================
  let client_input = update_client_input_datum(client_datum, mock.input)

  let inputs =
    [client_input]

  //===================Arrange outputs===================================
  let updated_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        ..client_datum.state,
        client_state: ClientState {
          ..client_datum.state.client_state,
          frozen_height: Height { revision_number: 0, revision_height: 1 },
        },
      },
    }

  let updated_output =
    update_client_output_datum(updated_datum, client_input.output)

  let outputs =
    [updated_output]

  //====================Arrange validity_range ==============================
  let validity_range =
    interval.between(
      ( header.signed_header.header.time - client_state.max_clock_drift ) / 1_000_000 + 1000,
      ( consensus_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1000,
    )

  //=======================Arrange context ==============================
  let purpose = Spend(mock.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      validity_range: validity_range,
    }

  let context = ScriptContext { purpose, transaction }

  spend_client(client_datum, redeemer, context)
}

test update_client_verify_adjacent_succeed() {
  let mock = setup()

  let trusted_height = Height { revision_number: 1, revision_height: 2 }

  // adjacent height
  let signed_header =
    SignedHeader {
      header: TmHeader {
        version: Consensus { block: block_protocol, app: 2 },
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        last_block_id: BlockID {
          hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          part_set_header: PartSetHeader {
            total: 10000,
            hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
        last_commit_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        data_hash: #"6d6e28b8b98b5327042ea50a57dd46e6cc851c72e528bdeaa6efdeeefe66a0b8",
        validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        consensus_hash: #"e5e566c41ed57e3ff8cc10f184178788b8faa602b07cf1f425217bd8179f1f24",
        app_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        last_results_hash: #"092e058630247ed6009863a12eee117d26cd9d08b5adcaab37f2ab35db475a37",
        evidence_hash: #"73865db08f49d58428905d389ab4ca4b96e45a3206c7a69d43a5dc7372e60714",
        proposer_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
            timestamp: 1577836805000000000,
            signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
            timestamp: 1577836805000000000,
            signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
            timestamp: 1577836805000000000,
            signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
            timestamp: 1577836805000000000,
            signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let header =
    Header { signed_header, validator_set, trusted_height, trusted_validators }

  //======================Arrange datum============================
  let trust_level = unchecked_rational.new(1, 3)

  let client_state =
    ClientState {
      chain_id: "testchain2-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: trusted_height,
      proof_specs: [],
    }

  let consensus_state =
    ConsensusState {
      timestamp: 157783680000000000,
      next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
      root: merkle.new_merkle_root(#""),
    }

  let consensus_states =
    [Pair(trusted_height, consensus_state)]

  let client_datum =
    ClientDatum {
      state: ClientDatumState { client_state, consensus_states },
      token: mock.client_token,
    }

  //======================Arrange redeemer============================
  let redeemer = UpdateClient { msg: HeaderCase(header) }

  //====================Arrange inputs==============================
  let client_input = update_client_input_datum(client_datum, mock.input)

  let inputs =
    [client_input]

  //===================Arrange outputs===================================
  let updated_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        client_state: ClientState {
          ..client_datum.state.client_state,
          latest_height: header_mod.get_height(header),
        },
        consensus_states: [
          Pair(header_mod.get_height(header),
          header_mod.consensus_state(header)),
        ],
      },
    }

  let updated_output =
    update_client_output_datum(updated_datum, client_input.output)

  let outputs =
    [updated_output]

  //====================Arrange validity_range ==============================
  let validity_range =
    interval.between(
      ( header.signed_header.header.time - client_state.max_clock_drift ) / 1_000_000 + 1000,
      ( consensus_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1000,
    )

  //=======================Arrange context ==============================
  let purpose = Spend(mock.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      validity_range: validity_range,
    }

  let context = ScriptContext { purpose, transaction }

  spend_client(client_datum, redeemer, context)
}

test update_client_verify_non_adjacent_succeed() {
  let mock = setup()

  let trusted_height = Height { revision_number: 1, revision_height: 1 }

  // non-adjacent height
  let signed_header =
    SignedHeader {
      header: TmHeader {
        version: Consensus { block: block_protocol, app: 2 },
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        last_block_id: BlockID {
          hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          part_set_header: PartSetHeader {
            total: 10000,
            hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
        last_commit_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        data_hash: #"6d6e28b8b98b5327042ea50a57dd46e6cc851c72e528bdeaa6efdeeefe66a0b8",
        validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        consensus_hash: #"e5e566c41ed57e3ff8cc10f184178788b8faa602b07cf1f425217bd8179f1f24",
        app_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        last_results_hash: #"092e058630247ed6009863a12eee117d26cd9d08b5adcaab37f2ab35db475a37",
        evidence_hash: #"73865db08f49d58428905d389ab4ca4b96e45a3206c7a69d43a5dc7372e60714",
        proposer_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
            timestamp: 1577836805000000000,
            signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
            timestamp: 1577836805000000000,
            signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
            timestamp: 1577836805000000000,
            signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
            timestamp: 1577836805000000000,
            signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
          pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
          pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
          pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
          pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
        pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let header =
    Header { signed_header, validator_set, trusted_height, trusted_validators }

  //======================Arrange datum============================
  let trust_level = unchecked_rational.new(1, 3)

  let client_state =
    ClientState {
      chain_id: "testchain2-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: trusted_height,
      proof_specs: [],
    }

  let consensus_state =
    ConsensusState {
      timestamp: 157783680000000000,
      next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
      root: merkle.new_merkle_root(#""),
    }

  let consensus_states =
    [Pair(trusted_height, consensus_state)]

  let client_datum =
    ClientDatum {
      state: ClientDatumState { client_state, consensus_states },
      token: mock.client_token,
    }

  //======================Arrange redeemer============================
  let redeemer = UpdateClient { msg: HeaderCase(header) }

  //====================Arrange inputs==============================
  let client_input = update_client_input_datum(client_datum, mock.input)

  let inputs =
    [client_input]

  //===================Arrange outputs===================================
  let updated_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        client_state: ClientState {
          ..client_datum.state.client_state,
          latest_height: header_mod.get_height(header),
        },
        consensus_states: [
          Pair(header_mod.get_height(header),
          header_mod.consensus_state(header)),
        ],
      },
    }

  let updated_output =
    update_client_output_datum(updated_datum, client_input.output)

  let outputs =
    [updated_output]

  //====================Arrange validity_range ==============================
  let validity_range =
    interval.between(
      ( header.signed_header.header.time - client_state.max_clock_drift ) / 1_000_000 + 1000,
      ( consensus_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1000,
    )

  //=======================Arrange context ==============================
  let purpose = Spend(mock.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      validity_range: validity_range,
    }

  let context = ScriptContext { purpose, transaction }

  spend_client(client_datum, redeemer, context)
}
