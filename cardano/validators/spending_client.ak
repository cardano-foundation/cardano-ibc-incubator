use aiken/dict
use aiken/interval
use aiken/list
use aiken/math/rational
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
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{
  BlockID, Commit, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle as misbehaviour_handle_mod
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
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
            dict.from_list(datum.state.consensus_states, height.compare),
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
            dict.from_list(datum.state.consensus_states, height.compare),
            msg,
          )
        trace @"spend_client: verify client msg succeeded"

        let found_misbehaviour =
          misbehaviour_handle_mod.check_for_misbehaviour(
            msg,
            dict.from_list(datum.state.consensus_states, height.compare),
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
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        app_hash: #"35c73ae54e3eb940a037effeba522aa34ed8d39c7b0f8af990bda1f252a343a7",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"537506e584088292181bf9fab1dc97f7e7abfd6b968193f7a42386b3efb5f8e3",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
            timestamp: 1577836805000000000,
            signature: #"283d17263b1cd843a19ebd1adbc497d2a4c239432aa55064f456863d3071d92d5e4aa8b0e8d21acc421d8858c780d579339e550056e7130c6fce818b985daa06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
            timestamp: 1577836805000000000,
            signature: #"4b82575e2d80e9e372508f5b3ee94e8c05d6fd47b51ab7a918f86e58a06bba4170df4440388dabb31a93bba5df05d4a94685a47e586d0eb383e50713c31fbb06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
            timestamp: 1577836805000000000,
            signature: #"4bca634ed3caa80bc8b4e43291b955a68823054a5b0c5bf6fec6a6232f3a4a4d10c296d368964e7a132a401651018fd6891a8a18a8dc48eb636531efecfd7205",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
            timestamp: 1577836805000000000,
            signature: #"45810b79e6f8df1519a3d6a7519ef9af6938ed72d774d9b2610b8e3e39ed8946160b5613130b4400fce9f2108c83ff4b113c035259b8396495c201a6f10e000e",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
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
  expect Some(trust_level) = rational.new(1, 3)

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
      next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
      root: merkle.new_merkle_root(#""),
    }

  let conflicted_consensus_state =
    ConsensusState {
      timestamp: 157783680000000000,
      next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
      root: merkle.new_merkle_root(#"636f6e666c696374696e672061707068617368"),
    }

  let conflicted_height = header_mod.get_height(header)

  let consensus_states =
    dict.new()
      |> dict.insert(trusted_height, consensus_state, height.compare)
      |> dict.insert(conflicted_height, conflicted_consensus_state, height.compare)

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: consensus_states |> dict.to_list(),
      },
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

  let signed_header =
    SignedHeader {
      header: TmHeader {
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        app_hash: #"35c73ae54e3eb940a037effeba522aa34ed8d39c7b0f8af990bda1f252a343a7",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"537506e584088292181bf9fab1dc97f7e7abfd6b968193f7a42386b3efb5f8e3",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
            timestamp: 1577836805000000000,
            signature: #"283d17263b1cd843a19ebd1adbc497d2a4c239432aa55064f456863d3071d92d5e4aa8b0e8d21acc421d8858c780d579339e550056e7130c6fce818b985daa06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
            timestamp: 1577836805000000000,
            signature: #"4b82575e2d80e9e372508f5b3ee94e8c05d6fd47b51ab7a918f86e58a06bba4170df4440388dabb31a93bba5df05d4a94685a47e586d0eb383e50713c31fbb06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
            timestamp: 1577836805000000000,
            signature: #"4bca634ed3caa80bc8b4e43291b955a68823054a5b0c5bf6fec6a6232f3a4a4d10c296d368964e7a132a401651018fd6891a8a18a8dc48eb636531efecfd7205",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
            timestamp: 1577836805000000000,
            signature: #"45810b79e6f8df1519a3d6a7519ef9af6938ed72d774d9b2610b8e3e39ed8946160b5613130b4400fce9f2108c83ff4b113c035259b8396495c201a6f10e000e",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
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
  expect Some(trust_level) = rational.new(1, 3)

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
      next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
      root: merkle.new_merkle_root(#""),
    }

  let prev_consensus_state =
    ConsensusState {
      timestamp: signed_header.header.time + 100,
      next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
      root: merkle.new_merkle_root(#"636f6e666c696374696e672061707068617368"),
    }

  let prev_height =
    Height {
      ..header_mod.get_height(header),
      revision_height: header_mod.get_height(header).revision_height,
    }

  let consensus_states =
    dict.new()
      |> dict.insert(trusted_height, consensus_state, height.compare)
      |> dict.insert(prev_height, prev_consensus_state, height.compare)

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: consensus_states |> dict.to_list(),
      },
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

  let signed_header =
    SignedHeader {
      header: TmHeader {
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        app_hash: #"35c73ae54e3eb940a037effeba522aa34ed8d39c7b0f8af990bda1f252a343a7",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"537506e584088292181bf9fab1dc97f7e7abfd6b968193f7a42386b3efb5f8e3",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
            timestamp: 1577836805000000000,
            signature: #"283d17263b1cd843a19ebd1adbc497d2a4c239432aa55064f456863d3071d92d5e4aa8b0e8d21acc421d8858c780d579339e550056e7130c6fce818b985daa06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
            timestamp: 1577836805000000000,
            signature: #"4b82575e2d80e9e372508f5b3ee94e8c05d6fd47b51ab7a918f86e58a06bba4170df4440388dabb31a93bba5df05d4a94685a47e586d0eb383e50713c31fbb06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
            timestamp: 1577836805000000000,
            signature: #"4bca634ed3caa80bc8b4e43291b955a68823054a5b0c5bf6fec6a6232f3a4a4d10c296d368964e7a132a401651018fd6891a8a18a8dc48eb636531efecfd7205",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
            timestamp: 1577836805000000000,
            signature: #"45810b79e6f8df1519a3d6a7519ef9af6938ed72d774d9b2610b8e3e39ed8946160b5613130b4400fce9f2108c83ff4b113c035259b8396495c201a6f10e000e",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let header =
    Header { signed_header, validator_set, trusted_height, trusted_validators }

  //======================Arrange datum============================
  expect Some(trust_level) = rational.new(1, 3)

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
      next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
      root: merkle.new_merkle_root(#""),
    }

  let consensus_states =
    dict.new()
      |> dict.insert(trusted_height, consensus_state, height.compare)

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: consensus_states |> dict.to_list(),
      },
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
        consensus_states: dict.new()
          |> dict.insert(
              header_mod.get_height(header),
              header_mod.consensus_state(header),
              height.compare,
            )
          |> dict.to_list(),
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

  let signed_header =
    SignedHeader {
      header: TmHeader {
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
        app_hash: #"35c73ae54e3eb940a037effeba522aa34ed8d39c7b0f8af990bda1f252a343a7",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"537506e584088292181bf9fab1dc97f7e7abfd6b968193f7a42386b3efb5f8e3",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
            timestamp: 1577836805000000000,
            signature: #"283d17263b1cd843a19ebd1adbc497d2a4c239432aa55064f456863d3071d92d5e4aa8b0e8d21acc421d8858c780d579339e550056e7130c6fce818b985daa06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
            timestamp: 1577836805000000000,
            signature: #"4b82575e2d80e9e372508f5b3ee94e8c05d6fd47b51ab7a918f86e58a06bba4170df4440388dabb31a93bba5df05d4a94685a47e586d0eb383e50713c31fbb06",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
            timestamp: 1577836805000000000,
            signature: #"4bca634ed3caa80bc8b4e43291b955a68823054a5b0c5bf6fec6a6232f3a4a4d10c296d368964e7a132a401651018fd6891a8a18a8dc48eb636531efecfd7205",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
            timestamp: 1577836805000000000,
            signature: #"45810b79e6f8df1519a3d6a7519ef9af6938ed72d774d9b2610b8e3e39ed8946160b5613130b4400fce9f2108c83ff4b113c035259b8396495c201a6f10e000e",
          },
        ],
      },
    }

  let validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let trusted_validators =
    ValidatorSet {
      validators: [
        Validator {
          address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
          pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
          voting_power: 1,
          proposer_priority: -3,
        },
        Validator {
          address: #"8f70433db177ea58e57836b756cf487ca8f5b450",
          pubkey: #"46837d4e0ce4557002a92d08b12d8b966a9d89c4d89516eab1cd49670b75b0fe",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"da10e4f46b5662742d796cc48df761d085e0fc99",
          pubkey: #"bd58264bb9f9919f30504070161ba96b5770813f5a2143649f180ff87dea8c9a",
          voting_power: 1,
          proposer_priority: 1,
        },
        Validator {
          address: #"dab3e318faa75ada1b92d4cad62c8bc550d957a9",
          pubkey: #"9c94cf6a695bace86630fa5fa98bac0ae826cdb5990a2aa16691e8d913c9ca83",
          voting_power: 1,
          proposer_priority: 1,
        },
      ],
      proposer: Validator {
        address: #"73c669bfb70e231a2e49dbfd93728559fb0311dd",
        pubkey: #"16a8f53845c5a5fdca7b125e6d5fa61346af949bb5e7b509ec35c4d5cbfc10d9",
        voting_power: 1,
        proposer_priority: -3,
      },
      total_voting_power: 0,
    }

  let header =
    Header { signed_header, validator_set, trusted_height, trusted_validators }

  //======================Arrange datum============================
  expect Some(trust_level) = rational.new(1, 3)

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
      next_validators_hash: #"9abde32dc3618ae1973138cec0a0efb6c2408840bcbfc1089f676e45096e4c70",
      root: merkle.new_merkle_root(#""),
    }

  let consensus_states =
    dict.new()
      |> dict.insert(trusted_height, consensus_state, height.compare)

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: consensus_states |> dict.to_list(),
      },
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
        consensus_states: dict.new()
          |> dict.insert(
              header_mod.get_height(header),
              header_mod.consensus_state(header),
              height.compare,
            )
          |> dict.to_list(),
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
