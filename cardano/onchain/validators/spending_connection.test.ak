use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembershipParams,
}
use ibc/client/mithril_client/protos/mithril_pb.{
  AnyMithrilClientState, CardanoHeight, Fraction, MithrilClientState,
  MithrilProtocolParameters,
}
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenAck, SpendConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  InnerSpec, LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_connection

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
        consensus_states: [Pair(proof_height, cons_state)],
      },
      token: client_token,
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock client script hash"),
        value: from_asset(client_token.policy_id, client_token.name, 1),
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
      address: from_script("mock script hash"),
      value: from_asset(token.policy_id, token.name, 1),
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
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
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
    MithrilClientState {
      chain_id: "42",
      latest_height: CardanoHeight { revision_number: 0, revision_height: 1 },
      frozen_height: CardanoHeight { revision_number: 0, revision_height: 0 },
      current_epoch: 1,
      trusting_period: 1,
      protocol_parameters: MithrilProtocolParameters {
        k: 0,
        m: 0,
        phi_f: Fraction { numerator: 0, denominator: 1 },
      },
      upgrade_path: [],
    }

  let proof_try = MerkleProof { proofs: [] }

  let proof_client = MerkleProof { proofs: [] }

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
      connection_end.convert_to_connection_end_proto(expected_connection),
    )

  let counterparty_client_state_bz =
    mithril_pb.marshal_for_any_client_state(
      AnyMithrilClientState {
        type_url: "/ibc.clients.mithril.v1.ClientState",
        value: counterparty_client_state,
      },
    ).2nd

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let verify_proof_redeemer: Redeemer =
    BatchVerifyMembership(
      [
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
    )

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(conn_input.output_reference), connection_redeemer),
      Pair(Mint(mock.verify_proof_policy_id), verify_proof_redeemer),
    ]

  expect connection_redeemer: SpendConnectionRedeemer = connection_redeemer

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: inputs,
      reference_inputs: reference_inputs,
      outputs: outputs,
      redeemers: redeemers,
      validity_range: validity_range,
    }

  spending_connection.spend_connection.spend(
    mock.client_minting_policy_id,
    mock.verify_proof_policy_id,
    Some(input_conn_datum),
    connection_redeemer,
    conn_input.output_reference,
    transaction,
  )
}
// test try_non_mock_data() {
//   let client_minting_policy_id =
//     #"9e2e296e2989fee464a1356f8c26fc5531e8f02befb529b5fb5a60d5"
//   let verify_proof_policy_id =
//     #"f94ca68702f061f67713298edda2dd59eaab7b9de711e4728bfe6e03"

//   let connection_auth_token = AuthToken {
//         policyId: #"38fd1b4dfe85a69ad60ca3f73096f90857b053e733ba508c667a1c04",
//         name: #"9ea42feedfd26becd19073df38f4604bd2e64b0119dd9b3031",
//       }

//   let input_datum =
//     ConnectionDatum {
//       state: ConnectionEnd {
//         client_id: "ibc_client-1",
//         versions: [
//           Version {
//             identifier: "1",
//             features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
//           },
//         ],
//         state: connection_state.Open,
//         counterparty: Counterparty {
//           client_id: "2000-cardano-mithril-2",
//           connection_id: "",
//           prefix: MerklePrefix { key_prefix: "ibc" },
//         },
//         delay_period: 0,
//       },
//       token: connection_auth_token,
//     }

//   let updated_datum =
//     ConnectionDatum {
//       state: ConnectionEnd {
//         client_id: "ibc_client-1",
//         versions: [
//           Version {
//             identifier: "1",
//             features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
//           },
//         ],
//         state: connection_state.Open,
//         counterparty: Counterparty {
//           client_id: "2000-cardano-mithril-2",
//           connection_id: "connection-2",
//           prefix: MerklePrefix { key_prefix: "ibc" },
//         },
//         delay_period: 0,
//       },
//       token: connection_auth_token,
//     }

//   let proof_height = CardanoHeight {
//       revision_number: 0,
//       revision_height: 4307,
//     }

//   let connection_redeemer = ConnOpenAck {
//     counterparty_client_state: MithrilClientState {
//       chain_id: "3432",
//       latest_height: CardanoHeight {
//         revision_number: 0,
//         revision_height: 1424,
//       },
//       frozen_height: CardanoHeight {
//         revision_number: 0,
//         revision_height: 0,
//       },
//       current_epoch: 38,
//       trusting_period: 129600000000000,
//       protocol_parameters: MithrilProtocolParameters {
//         k: 5,
//         m: 100,
//         phi_f: Fraction {
//           numerator: 17,
//           denominator: 20,
//         },
//       },
//       upgrade_path: [],
//     },
//     proof_try: MerkleProof {
//       proofs: [
//         CommitmentProof {
//           proof: CommitmentProof_Exist {
//             exist: {
//               key: "636f6e6e656374696f6e732f636f6e6e656374696f6e2d32",
//               value: "0a16323030302d63617264616e6f2d6d69746872696c2d3212230a0131120d4f524445525f4f524445524544120f4f524445525f554e4f524445524544180222230a0c6962635f636c69656e742d31120c636f6e6e656374696f6e2d311a050a03696263",
//               leaf: LeafOp {
//                 hash: 1,
//                 prehash_key: 0,
//                 prehash_value: 1,
//                 length: 1,
//                 prefix: "0002e23d",
//               },
//               path: [
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0204e23d20231ec0769ed635e280fd1d5aa64096b53f4826302ebe3c9e6ee959df46c4e4e720",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0408e23d20",
//                   suffix: "20c3f9efc9a3716b7fbf5f0efd845bab965659e0d4963f1789b2ff43c192c296d9",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "060ce23d204a2ddb1636e8cdee4726f58eb9c97146e96da9cfa89cb256b59fd9f417c5cc2620",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0818e23d20",
//                   suffix: "20a6f0c217966fb88a03191236554ec4414d7743444aca423607e97072f78e0308",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0c36e04120e67799408ad0ca94cbf8f9d6f8052b582e24f8edc875b5debdd1f76c2eaad38b20",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0e64e0412039320167a5a81774e382d624fb8f53e0490c0d57097b4ce13e6ea5ef96995a9b20",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "10c001e041202174dc719c3824e60fe016fa9cd3a3a578385806b9a8074140711c75dc16328420",
//                   suffix: "",
//                 },
//               ]
//             }
//           }
//         },
//         CommitmentProof {
//           proof: CommitmentProof_Exist {
//             exist: {
//               key: "696263",
//               value: "0017eee38d5e7d7a82f8dee1dc86e54aecb6dc1fcaa9114d99d52e69dae534a6",
//               leaf: LeafOp {
//                 hash: 1,
//                 prehash_key: 0,
//                 prehash_value: 1,
//                 length: 1,
//                 prefix: "00",
//               },
//               path: [
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "01",
//                   suffix: "f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0176296b655bd54a7397f37e0b2c6c863029a29e4eeddedcb063c6839209a88996",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "01",
//                   suffix: "381fe6c71ac03eaf7d2bc970c0dd01c055a150251864848311bd448ab19a7833",
//                 },
//               ]
//             }
//           }
//         }
//       ]
//     },
//     proof_client: MerkleProof {
//       proofs: [
//         CommitmentProof {
//           proof: CommitmentProof_Exist {
//             exist: {
//               key: "636c69656e74732f323030302d63617264616e6f2d6d69746872696c2d322f636c69656e745374617465",
//               value: "0a232f6962632e636c69656e74732e6d69746872696c2e76312e436c69656e745374617465121f0a023432120310900b1a0020262a0408c0f407320a080510641a0408111014",
//               leaf: LeafOp {
//                 hash: 1,
//                 prehash_key: 0,
//                 prehash_value: 1,
//                 length: 1,
//                 prefix: "0002e041",
//               },
//               path: [
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0204e04120",
//                   suffix: "200aba125c7d414aec1d9e3b213b223223c3a5ef9474808b39ff069ad39c69cfc1",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0408e04120",
//                   suffix: "2029380b21dfdb8c5a9a091e2bda0a9ac2655c79636633d9061768a2ab47265dad",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "060ce04120",
//                   suffix: "2039eac247da7dc3973a78ae7fc64085cddc7963205a05ace78fe282da5934c1d9",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0814e04120dc347722e757e290393ef04cbc714b76b5ffd74d31f0ee225e57ac6d9f19784920",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0a2ce04120874d2da69087f29a147724d45e0f1bde72410dca43b75a9392e3198b276a944720",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0c5ce0412001d973048823dc745249b4f8e28a90ea1cd7376fe2dbfda3ca591e609d807fc920",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "10c001e04120",
//                   suffix: "20b6dec90d95d1f49513ea39600b033e1aa94411c0fc7768fd5dc9b5eb9e639f8b",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "12e602e04120c191258c8996f7908445745e2451e61a5e2009c1d57f9f9f4e575cd27e9c70cf20",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "14e604e041202c52b6d1c1936db571e427349d8a08a094a597825af1734398ee6c0cff43a61f20",
//                   suffix: "",
//                 },
//               ]
//             }
//           }
//         },
//         CommitmentProof {
//           proof: CommitmentProof_Exist {
//             exist: {
//               key: "696263",
//               value: "0017eee38d5e7d7a82f8dee1dc86e54aecb6dc1fcaa9114d99d52e69dae534a6",
//               leaf: LeafOp {
//                 hash: 1,
//                 prehash_key: 0,
//                 prehash_value: 1,
//                 length: 1,
//                 prefix: "00",
//               },
//               path: [
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "01",
//                   suffix: "f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "0176296b655bd54a7397f37e0b2c6c863029a29e4eeddedcb063c6839209a88996",
//                   suffix: "",
//                 },
//                 InnerOp {
//                   hash: 1,
//                   prefix: "01",
//                   suffix: "381fe6c71ac03eaf7d2bc970c0dd01c055a150251864848311bd448ab19a7833",
//                 },
//               ]
//             }
//           }
//         }
//       ]
//     },
//     proof_height: proof_height,
//   }

//   let verify_proof_redeemer : Redeemer =
//     BatchVerifyMembership(
//       [
//         VerifyMembershipParams {
//           cs: client_datum_state.client_state,
//           cons_state: consensus_state,
//           height: proof_height,
//           delay_time_period: 0,
//           delay_block_period: 0,
//           proof: proof_try,
//           path: conn_merkle_path,
//           value: expected_connection_bz,
//         },
//         VerifyMembershipParams {
//           cs: client_datum_state.client_state,
//           cons_state: consensus_state,
//           height: proof_height,
//           delay_time_period: 0,
//           delay_block_period: 0,
//           proof: proof_client,
//           path: client_merkle_path,
//           value: counterparty_client_state_bz,
//         },
//       ],
//     )

//   let redeemers: Pairs<ScriptPurpose, Redeemer> =
//     [
//       Pair(Spend(output_reference), connection_redeemer),
//       Pair(Mint(verify_proof_policy_id), verify_proof_redeemer),
//     ]

//   let connection_input = Input {
//     output_reference: OutputReference {
//       transaction_id: #"14495989d441944b13bc7f9a7cce4ec71ce97f8eae4db800b9db59884a9ae54e",
//       output_index: 1,
//     },
//     output: Output {
//       address: Address {
//         payment_credential: #"7005599342b255c3178be53b53999d84315891725e3e180218b34bccf9"
//       },
//       value: from_asset(connection_auth_token.policy_id, connection_auth_token.name, 1),
//       datum: InlineDatum(input_conn_datum),
//       reference_script: None,
//     },
//   }

//   let transaction =
//     Transaction {
//       ..transaction.placeholder,
//       inputs: inputs,
//       reference_inputs: reference_inputs,
//       outputs: outputs,
//       redeemers: redeemers,
//       validity_range: validity_range,
//     }

//   spending_connection.spend_connection.spend(
//     client_minting_policy_id,
//     verify_proof_policy_id,
//     Some(updated_datum),
//     connection_redeemer,
//     conn_input.output_reference,
//     transaction,
//   )
// }
