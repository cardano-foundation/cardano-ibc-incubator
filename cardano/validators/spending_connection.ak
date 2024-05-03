use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Hash}
use aiken/interval
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId, ValidityRange,
}
use aiken/transaction/credential.{Script}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/cardano_client/client_state as cardano_client
use ibc/client/cardano_client/protos/cardano_pb.{
  AnyCardanoClientState, CardanoClientState, CardanoHeight, CardanoValidator,
  TokenConfigs,
}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyMembershipParams,
  VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenAck, ConnOpenConfirm, SpendConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, InnerSpec,
  LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/utils/test_utils
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  fn spend_connection(
    datum: ConnectionDatum,
    redeemer: SpendConnectionRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction { outputs, reference_inputs, validity_range, redeemers, .. } =
      transaction

    expect spent_output |> auth.contain_auth_token(datum.token)
    trace @"spend_connection: input contains auth token"

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ConnectionDatum =
      validator_utils.get_inline_datum(updated_output)
    trace @"spend_connection: found connection output"

    expect auth.contain_auth_token(updated_output, datum.token)
    trace @"spend_connection: output contains connection token"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"spend_connection: extract tx valid_to"

    expect Some(connection_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let connection_id =
      conn_keys.format_connection_identifier(connection_sequence)
    trace @"spend_connection: extract connection_id"

    when redeemer is {
      ConnOpenAck(
        counterparty_client_state,
        proof_try,
        proof_client,
        proof_height,
      ) -> {
        trace @"spend_connection: ConnOpenAck branch"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            datum.state.client_id,
          )
        trace @"spend_connection: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == Active
        trace @"spend_connection: client status is active"

        expect
          connection_datum.is_connection_open_ack_valid(datum, updated_datum)
        trace @"spend_connection: connection datum is updated valid"

        expect
          validate_conn_open_ack_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            counterparty_client_state,
            proof_try,
            proof_client,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )
        trace @"spend_connection: validate_conn_open_ack_proof"

        True
      }
      ConnOpenConfirm { proof_ack, proof_height } -> {
        trace @"spend_connection: ConnOpenConfirm branch"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            datum.state.client_id,
          )
        trace @"spend_connection: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == Active
        trace @"spend_connection: client status is active"

        expect
          connection_datum.is_connection_open_confirm_valid(
            datum,
            updated_datum,
          )
        trace @"spend_connection: connection datum is updated valid"

        expect
          validate_conn_open_confirm_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            proof_ack,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )
        trace @"spend_connection: validate_conn_open_ack_proof"

        True
      }
    }
  }
}

fn validate_conn_open_ack_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
  counterparty_client_state: CardanoClientState,
  proof_try: MerkleProof,
  proof_client: MerkleProof,
  proof_height: Height,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  expect cardano_client.validate_self_client(counterparty_client_state)

  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      connection_id,
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.TryOpen,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let conn_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )

  let client_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [client_keys.full_client_state_path(connection.counterparty.client_id)],
      ),
    )

  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height_mod.compare)
      |> dict.get(proof_height)

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      Some(connection_end.convert_to_connection_end_proto(expected_connection)),
    )

  let counterparty_client_state_bz =
    cardano_pb.marshal_for_any_client_state(
      Some(
        AnyCardanoClientState {
          type_url: "/ibc.clients.cardano.v1.ClientState",
          value: Some(counterparty_client_state),
        },
      ),
    )

  expect Some(verify_proof_redeemer) =
    dict.get(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  expect
    verify_proof_redeemer == BatchVerifyMembership {
      items: [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_try,
          path: conn_merkle_path,
          value: expected_connection_bz,
        },
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_client,
          path: client_merkle_path,
          value: counterparty_client_state_bz,
        },
      ],
    }

  True
}

fn validate_conn_open_confirm_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
  proof_ack: MerkleProof,
  proof_height: Height,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      connection_id,
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.Open,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      Some(connection_end.convert_to_connection_end_proto(expected_connection)),
    )

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )

  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height_mod.compare)
      |> dict.get(proof_height)

  expect Some(verify_proof_redeemer) =
    dict.get(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  expect
    verify_proof_redeemer == VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_ack,
      path: merkle_path,
      value: expected_connection_bz,
    }

  True
}

//================================================Test==============================================
type MockData {
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  connection_id: ByteArray,
  connection_token: AuthToken,
  handler_token: AuthToken,
  client_id: ByteArray,
  client_input: Input,
  validity_range: ValidityRange,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  //========================Client============================
  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"be42d79cf15375efd54cf594c9f016db8c8b8dc4e91f35f11bba000ec7e9f439",
      root: MerkleRoot {
        hash: #"3d89dd39e1f1c7a0cec08f3ebf31fcb485f42068fcb79a8aeb3a9ca9f4e7091d",
      },
    }

  let proof_specs =
    [
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 33,
          min_prefix_length: 4,
          max_prefix_length: 12,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 32,
          min_prefix_length: 1,
          max_prefix_length: 1,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
    ]

  let client_state =
    ClientState {
      chain_id: "testchain1-1",
      trust_level: unchecked_rational.from_int(1),
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: Height { revision_number: 1, revision_height: 13 },
      proof_specs,
    }

  let client_id = "ibc_client-44"

  let client_sequence = client_keys_mod.parse_client_id_sequence(client_id)

  let client_token_name =
    auth.generate_token_name(
      handler_token,
      client_keys_mod.client_prefix,
      client_sequence,
    )

  let client_minting_policy_id = "mock client_minting_policy_id"

  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: dict.new()
          |> dict.insert(proof_height, cons_state, height_mod.compare)
          |> dict.to_list(),
      },
      token: client_token,
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "tx_hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("mock client script hash"),
        value: value.from_asset(client_token.policy_id, client_token.name, 1),
        datum: InlineDatum(client_datum),
        reference_script: None,
      },
    }

  //==========================ValidityRange===========================
  let valid_to =
    ( cons_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1
  let validity_range = interval.before(valid_to)

  //==========================Connection===============================
  let connection_id = "connection-43"
  let connection_sequence =
    conn_keys.parse_connection_id_sequence(connection_id)
  let connection_token_name =
    auth.generate_token_name(
      handler_token,
      conn_keys.connection_prefix,
      connection_sequence,
    )
  let connection_token =
    AuthToken {
      policy_id: "mock connection policy_id",
      name: connection_token_name,
    }

  MockData {
    client_minting_policy_id,
    verify_proof_policy_id: "mock verify_proof_policy_id",
    spend_connection_script_hash: "mock spend_connection_script_hash",
    connection_id,
    connection_token,
    handler_token,
    client_id,
    client_input,
    validity_range,
  }
}

fn build_output(datum: Data, token: AuthToken) -> Output {
  let output =
    Output {
      address: credential.from_script("mock script hash"),
      value: value.from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    }

  output
}

fn build_input(datum: Data, token: AuthToken) -> Input {
  let output = build_output(datum, token)

  let input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "mock tx hash" },
        output_index: 0,
      },
      output,
    }

  input
}

test conn_open_ack_succeed() {
  let mock = setup()

  //========================arrange inputs=======================
  let input_conn =
    ConnectionEnd {
      client_id: mock.client_id,
      versions: version.get_compatible_versions(),
      state: connection_state.Init,
      counterparty: Counterparty {
        client_id: #"3039392d63617264616e6f2d3430",
        connection_id: "",
        prefix: MerklePrefix { key_prefix: #"696263" },
      },
      delay_period: 0,
    }

  let input_conn_datum =
    ConnectionDatum { state: input_conn, token: mock.connection_token }

  let conn_input = build_input(input_conn, mock.connection_token)

  let inputs =
    [conn_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 0, revision_height: 188485 }

  let cons_state =
    ConsensusState {
      timestamp: 1711966816442701366,
      next_validators_hash: #"f88f12713a51934a3dc227fb41830b06e61db5b9518af2ac5b4d549f0f516ac5",
      root: MerkleRoot {
        hash: #"cc4f52848dc32a5ccc85f2aac7c14fae959173570915db4ed9408b1ebdf10afe",
      },
    }

  let client_input =
    test_utils.update_client(proof_height, cons_state, mock.client_input)

  let reference_inputs =
    [client_input]

  //========================arrange outputs=======================
  let output_conn_datum =
    ConnectionDatum {
      ..input_conn_datum,
      state: ConnectionEnd {
        ..input_conn_datum.state,
        state: connection_state.Open,
        counterparty: Counterparty {
          ..input_conn_datum.state.counterparty,
          connection_id: #"636f6e6e656374696f6e2d3232",
        },
      },
    }

  let conn_output = build_output(output_conn_datum, mock.connection_token)

  let outputs =
    [conn_output]

  //========================arrange validity_range=======================
  let validity_range = mock.validity_range

  //========================arrange redeemers=======================
  let counterparty_client_state =
    CardanoClientState {
      chain_id: "42",
      latest_height: Some(
        CardanoHeight { revision_number: 0, revision_height: 64523 },
      ),
      frozen_height: Some(
        CardanoHeight { revision_number: 0, revision_height: 0 },
      ),
      valid_after: 0,
      genesis_time: 1711709267,
      current_epoch: 0,
      epoch_length: 432000,
      slot_per_kes_period: 129600,
      current_validator_set: [
        Some(
          CardanoValidator {
            vrf_key_hash: #"66656331376564363063626632656335626533663036316662346465306236656631663230393437636662666365356662323738336431326633663639666635",
            pool_id: #"706f6f6c31336773656b367664386468717873753334367a766165333072346d746437377974683037666363377034396b71633366643039",
          },
        ),
      ],
      next_validator_set: [
        Some(
          CardanoValidator {
            vrf_key_hash: #"66656331376564363063626632656335626533663036316662346465306236656631663230393437636662666365356662323738336431326633663639666635",
            pool_id: #"706f6f6c31336773656b367664386468717873753334367a766165333072346d746437377974683037666363377034396b71633366643039",
          },
        ),
      ],
      trusting_period: 1200,
      upgrade_path: [],
      token_configs: Some(
        TokenConfigs {
          handler_token_unit: #"62323730666536376136646339323263363963306137616439646532663035303164343862663537333764653037633164363362633063663638363136653634366336353732",
          client_policy_id: #"3330393866313563653632633864646237383437616162613462373630336235616661336639643961346532616137643738646162373335",
          connection_policy_id: #"3938313737383931336138383335363034646235643634643437626131366466613863303038623962396237313836373630303465643130",
          channel_policy_id: #"6635623065313430303234316136386564636330666236633137653038386537353133343661346238656566323433343963653337306462",
        },
      ),
    }

  let proof_try =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"636f6e6e656374696f6e732f636f6e6e656374696f6e2d3232",
              value: #"0a0e3039392d63617264616e6f2d343012230a0131120d4f524445525f4f524445524544120f4f524445525f554e4f524445524544180222250a0d6962635f636c69656e742d3434120d636f6e6e656374696f6e2d34331a050a03696263",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"0002888117",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02048881172089adfcdf24aef8aa46eed6847e1a16dd279dc9f9746c56257c8d0e887ff9ed1220",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0406888117207469a141062fd114baa5d96512c260be462a609fb34f12a8936be115961b986d20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060e88811720",
                  suffix: #"20925ded82f4cc67af8c2cc59d9a30e170a6be5857af253831991847f9320144eb",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"081a8881172066a6d5d972f91ddf37ef7e3ee65906a71e87f421c456a88aca9c6713983362df20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a26888117202c27a8fc2e4548b950d9bc72c21d6d42802c938478ad7874dcde915347f4943d20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c4288811720e27e8d6e913d2c21cd6bd48605f0ae7f4fa3d55f89126560f765ee3847ea694c20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0e6488811720d3d5600013091aec12e41fd8e17b9e04e3a276b2dc09b765d9c6bdab5b3b759620",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"10cc0188811720",
                  suffix: #"20bdafcb03083e67a184a251162afc4874931ac9d872a27745b384c0ce7abe8afe",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"12da02888117203932e3a0ca6a89fdf5bca0f1f8c17a8593dc987df8a308f9abbaee26d167606c20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"1484048881172050a6875a7f50f17427d06009ac24cc89a48ab2f91702ffe3182729298096de1320",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"16f40788811720acbbc6bbd4c75971fa14fbb3429b46fd75dc2e1bfdd1cfa41952dc1e4e472fc120",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"18f812888117207161bae3ee76dd25fc3c82b3eb624b802affcb2f4d55cb4248d20dc52f2b139d20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"1ae02d88811720321a34448eafe4e081a13c7d5726d3ebe33eee2e9cb3b85ecd7859f60fc7cfe020",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"1ca43b888117209dd67d4752e719bba824f999d6ca8c4de7014e7441f4e31270d6494c783159fa20",
                  suffix: #"",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"f2147c15f30eeaa019f6b7f8054ad342a4c405d0ee201b50aba41f2d72e40205",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01f5d7b2adafe059f2c8e8fc5351926018799d8f7c3ef0515ef6924bc3db56ba9f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"0a9b3a1b26ae98d98fa88156858afe55f297c6fda5a2286048606153601a8c1a",
                },
              ],
            },
          },
        },
      ],
    }

  let proof_client =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"636c69656e74732f3039392d63617264616e6f2d34302f636c69656e745374617465",
              value: #"0a232f6962632e636c69656e74732e63617264616e6f2e76312e436c69656e7453746174651292040a0234321204108bf8031a0028d3b89ab0063880af1a40c0f4074a7c0a40666563313765643630636266326563356265336630363166623464653062366566316632303934376366626663653566623237383364313266336636396666351238706f6f6c31336773656b367664386468717873753334367a766165333072346d746437377974683037666363377034396b71633366643039527c0a40666563313765643630636266326563356265336630363166623464653062366566316632303934376366626663653566623237383364313266336636396666351238706f6f6c31336773656b367664386468717873753334367a766165333072346d746437377974683037666363377034396b7163336664303958b0096af6010a4662323730666536376136646339323263363963306137616439646532663035303164343862663537333764653037633164363362633063663638363136653634366336353732123833303938663135636536326338646462373834376161626134623736303362356166613366396439613465326161376437386461623733351a38393831373738393133613838333536303464623564363464343762613136646661386330303862396239623731383637363030346564313022386635623065313430303234316136386564636330666236633137653038386537353133343661346238656566323433343963653337306462",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"0002868117",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"020488811720",
                  suffix: #"20328fb5843cd5d61a4bb1fb6da67d3a6b51bc81f2beae1124304c9a2b850b9159",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"040688811720",
                  suffix: #"20ef3c6215c63d3daeb3362ea6078b0ac5184e000f20c066ebb58e8c00b145dd62",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060e88811720adf96348c28c72fe7a409904c7e094a4cd35c97ee9854c3d2116f84f09ca981620",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0818888117200f379666585c9835939a0316f0118f64d9125e75eda8ff8960a184fdbee6d11920",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a2c888117207edb20ed6496bb27a5ff4b6cd6f86726eaee73615f07444d254dbd2a07eb72f120",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c5888811720",
                  suffix: #"20c8763742e3279ebd70783a2b61c9875b38ac9368cb63678136234a86991e61eb",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0e9a01888117203e660228dbd5f88fc9b3645df3057beec6eb8c7a2f89d87951e6a20c7c99c24620",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"10c602888117205b867827d567c0810bdb0c5acb7cf46a1e672330e3966e957c0862f1d8a09b8120",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"128c0488811720360ede7f001023f5e15e4360ebbe8afd5faac6703df62f50819f08de2f2136b420",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"14cc088881172030c5e482932be6142f690ab3ff8ddd4101ae599b7f78d16dad016ad857fa9ec820",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"16b20d88811720",
                  suffix: #"20427a3ea8aaced318c4dc2d5cebd6f3dac97ef84d3c749bf890f33d1f0a025f4d",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"18e81a88811720a98a6bbd7f1e09700dda17535513e84e88f64232f6c9ae0ce43239d2f3e2532f20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"1ae02d88811720",
                  suffix: #"20e0a6d7e6ad7722a63d142943cfae66234301c3a67c68d520270e450cdefbc7d3",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"1ca43b888117209dd67d4752e719bba824f999d6ca8c4de7014e7441f4e31270d6494c783159fa20",
                  suffix: #"",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"f2147c15f30eeaa019f6b7f8054ad342a4c405d0ee201b50aba41f2d72e40205",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01f5d7b2adafe059f2c8e8fc5351926018799d8f7c3ef0515ef6924bc3db56ba9f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"0a9b3a1b26ae98d98fa88156858afe55f297c6fda5a2286048606153601a8c1a",
                },
              ],
            },
          },
        },
      ],
    }

  let connection_redeemer: Redeemer =
    ConnOpenAck {
      counterparty_client_state,
      proof_try,
      proof_client,
      proof_height,
    }

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)

  let client_datum_state = client_datum.state
  let connection = output_conn_datum.state

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let conn_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )

  let client_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [client_keys.full_client_state_path(connection.counterparty.client_id)],
      ),
    )

  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      mock.connection_id,
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.TryOpen,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      Some(connection_end.convert_to_connection_end_proto(expected_connection)),
    )

  let counterparty_client_state_bz =
    cardano_pb.marshal_for_any_client_state(
      Some(
        AnyCardanoClientState {
          type_url: "/ibc.clients.cardano.v1.ClientState",
          value: Some(counterparty_client_state),
        },
      ),
    )

  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height_mod.compare)
      |> dict.get(proof_height)

  let verify_proof_redeemer =
    BatchVerifyMembership {
      items: [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_try,
          path: conn_merkle_path,
          value: expected_connection_bz,
        },
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_client,
          path: client_merkle_path,
          value: counterparty_client_state_bz,
        },
      ],
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(conn_input.output_reference),
          connection_redeemer,
          validator_utils.compare_script_purpose,
        )
      |> dict.insert(
          Mint(mock.verify_proof_policy_id),
          verify_proof_redeemer,
          validator_utils.compare_script_purpose,
        )

  expect connection_redeemer: SpendConnectionRedeemer = connection_redeemer

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(conn_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_connection(
    mock.client_minting_policy_id,
    mock.verify_proof_policy_id,
    input_conn_datum,
    connection_redeemer,
    context,
  )
}
