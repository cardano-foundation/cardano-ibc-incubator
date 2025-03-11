use aiken/collection/pairs
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/state.{Open}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{RecvPacket}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnRecvPacket, OtherModuleData,
}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, InnerSpec,
  LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/recv_packet
use spending_channel/spending_channel_fixture.{MockData, setup}

test succeed_recv_packet() {
  let mock_data = setup()

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: chan_state_mod.Open,
      ordering: chan_order_mod.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 19 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"7c3af87e2c224be7f3b2d7b2ab467e69b1a4ef5947fbe76d55e9091e16172346",
      root: MerkleRoot {
        hash: #"11a648b10463e8a96c77976940ee316117bb8214bd380e267aa31cf39ef8a09a",
      },
    }

  let client_input =
    test_utils.update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let ack = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let bz_ack = acknowledgement_mod.acknowledgement(ack)
  let commit_ack = acknowledgement_mod.commit_acknowledgement(bz_ack)

  let packet =
    Packet {
      sequence: 1,
      source_port: input_channel.counterparty.port_id,
      source_channel: input_channel.counterparty.channel_id,
      destination_port: mock_data.port_id,
      destination_channel: channel_id,
      data: "mock packet data",
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1735689600000000000,
    }

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: [
          Pair(packet.sequence, ""),
          ..input_channel_datum.state.packet_receipt
        ],
        packet_acknowledgement: [
          Pair(packet.sequence, commit_ack),
          ..input_channel_datum.state.packet_acknowledgement
        ],
      },
    }

  let channel_output =
    test_utils.build_channel_output(
      output_channel_datum,
      mock_data.channel_token,
    )

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_commitment =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"636f6d6d69746d656e74732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
              value: #"fa365cf5deedf3169bfe56010f101be23eac638d3bc9f43c7634f78ef718aa10",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"000224",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"020424205fd25b3dc1314970dcbf74075f9d165af4a185eea459128edf21cfacc14b9c9e20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04062420",
                  suffix: #"2067b76c7b82d60ebee7f41dd11a02534c1a16efa70c217310356230dfd5ad0c20",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060a2420",
                  suffix: #"20f21e95601cbd0028a9c3c4effd8afbbe068f086ab152ec0edb9cde2fdd6c568f",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08162420",
                  suffix: #"2038afa1cc8688eedde1256daab2bff7aade39a6db7320d62f47581fb65d9e8024",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a2424203dd3101284b12a1c86ec48897aaf11781985de6f1eb75fdb6c8011a7d3e4d2ad20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c462420617a9deebfac19d019bc9f7179c90ed228ee21d7330bc10568918f6f26cbb75320",
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
              value: #"6cfc3a7872f9703bcd5027ba7197890652bf545bd77a4ae7fa8b780746c91e42",
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
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01ef0d5a163ae333b43e2956b2d9660e65aaa9a1e2f90b30a91d97b5d0f12fb1fc",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"04634f3eedce1a4677cef6f418f7671437db345ad7e26581393b7cc6e722a2c7",
                },
              ],
            },
          },
        },
      ],
    }

  let spend_channel_redeemer: Redeemer =
    RecvPacket { packet, proof_commitment, proof_height }

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket { channel_id, acknowledgement: ack, data: OtherModuleData },
    )

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)

  let client_datum_state = client_datum.state
  let connection = connection_datum.state

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            packet.source_port,
            packet.source_channel,
            packet.sequence,
          ),
        ],
      ),
    )
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let commitment = packet_mod.commit_packet(packet)

  let verify_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_commitment,
      path: merkle_path,
      value: commitment,
    }

  let recv_packet_redeemer: Redeemer = mock_data.channel_token

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Mint(mock_data.recv_packet_policy_id), recv_packet_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
    ]

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

  recv_packet.recv_packet.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.channel_token,
    mock_data.recv_packet_policy_id,
    transaction,
  )
}

test recv_packet_non_mock_data() {
  let client_minting_policy_id =
    #"dcecce6c178dae972476121042b79ac470bd9c2797bedea2c1906e8a"
  let connection_minting_policy_id =
    #"e4d9c21512117b37daf57e852c5629dc8f5f9e4b1a8dde3312e597df"
  let port_minting_policy_id =
    #"b28620755b65066a860e6ff8e1772bb65e73b60dd21d099b2457052b"
  let verify_proof_policy_id =
    #"f94ca68702f061f67713298edda2dd59eaab7b9de711e4728bfe6e03"
  let recv_packet_policy_id =
    #"fb62d2738f5a9fdf049ef19229f82b4b427ed0aceab4282ba9a56039"

  let validity_range = interval.before(1741267622930)

  let channel_token =
    AuthToken {
      name: #"c9fcf5b1fea9b80fe522703584970ab449b0e30b239b722030",
      policy_id: port_minting_policy_id,
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: Channel {
          state: chan_state_mod.Open,
          ordering: chan_order_mod.Unordered,
          counterparty: ChannelCounterparty {
            port_id: "vesseloracle",
            channel_id: "channel-1",
          },
          connection_hops: ["connection-0"],
          version: "ics20-1",
        },
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-100",
      token: channel_token,
    }

  let updated_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: [
          Pair(1, ""),
          ..input_channel_datum.state.packet_receipt
        ],
        packet_acknowledgement: [
          Pair(
            1,
            #"08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c",
          ),
          ..input_channel_datum.state.packet_acknowledgement
        ],
      },
    }

  let spend_channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"713a117bf0b6f537ef10dbe48d6ce55cfe9f419553c6ff9d0ed3d7d6e72407ec",
        output_index: 0,
      },
      output: Output {
        address: from_script(channel_token.policy_id),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(input_channel_datum),
        reference_script: None,
      },
    }

  let inputs =
    [spend_channel_input]

  let outputs =
    [
      Output {
        address: from_script(channel_token.policy_id),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(updated_channel_datum),
        reference_script: None,
      },
    ]

  let merkle_proof =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"636f6d6d69746d656e74732f706f7274732f76657373656c6f7261636c652f6368616e6e656c732f6368616e6e656c2d312f73657175656e6365732f31",
              value: #"d6c57fcf5d631c919dc03313939bb2837eb58d2429ccdc0e58da8892682ad808",
              leaf: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"0002fc15",
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0204ec2120",
                  suffix: #"2098d56cfbf609dcb504c0e2e783e749308e5f906b700d862ba11783cfbc740eef",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0408ec2120",
                  suffix: #"204567bfa5733c1c6df4e45c62d3b76d92dfaab4507bae2031a9f616d03ab90fc6",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0812962820b55104911444196c40bb644c895b81b4af8e7fd426190108ccbfe8244d74766120",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a2a962820",
                  suffix: #"2051b989ccba53bef32ebd77b31327f8a8d639036cd0233225902f129a5e63f053",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c4e962820529acae54cab0c6a7935224978d33574ca6d5fe9c00c0ff357595b3c43b26c9d20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"10c2019628208876c99e1efbead55b0569096fa38174906988292eae9de52144bb0e7a36da5820",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"12b4029628202ec19c15dc5338f58df8b4d5793f276ac8cb24fa3ebe45294fc393feacd54f7220",
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
              value: #"4efda2f59ef35f61cb713e7c4f15726c5a6b10d16ad395699e67964096e552e9",
              leaf: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
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
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01d9da9cc6cd7d15bfc13c7acb16306edaed0295c6934e33675a3101dd4f0333ad",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"bdad1f5b93fa637bc5444eb8825b9dd49d7730109813ae4db53a815ceb74b4b5",
                },
              ],
            },
          },
        },
      ],
    }

  let mint_verifying_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: ClientState {
        chain_id: #"76657373656c6f7261636c65",
        trust_level: UncheckedRational { numerator: 1, denominator: 3 },
        trusting_period: 129600000000000,
        unbonding_period: 1814400000000000,
        max_clock_drift: 600000000000,
        frozen_height: Height { revision_number: 0, revision_height: 0 },
        latest_height: Height { revision_number: 0, revision_height: 2709 },
        proof_specs: [
          ProofSpec {
            leaf_spec: LeafOp {
              hash: 1,
              prehash_key: 0,
              prehash_value: 1,
              length: 1,
              prefix: #"00",
            },
            inner_spec: InnerSpec {
              child_order: [0, 1],
              child_size: 33,
              min_prefix_length: 4,
              max_prefix_length: 12,
              empty_child: #"",
              hash: 1,
            },
            max_depth: 0,
            min_depth: 0,
            prehash_key_before_comparison: False,
          },
          ProofSpec {
            leaf_spec: LeafOp {
              hash: 1,
              prehash_key: 0,
              prehash_value: 1,
              length: 1,
              prefix: #"00",
            },
            inner_spec: InnerSpec {
              child_order: [0, 1],
              child_size: 32,
              min_prefix_length: 1,
              max_prefix_length: 1,
              empty_child: #"",
              hash: 1,
            },
            max_depth: 0,
            min_depth: 0,
            prehash_key_before_comparison: False,
          },
        ],
      },
      cons_state: ConsensusState {
        timestamp: 1741257055001676886,
        next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
        root: MerkleRoot {
          hash: #"3adc293f2faa9b848c7369430a8ef73377e30ffee1d686cda373c630cda43039",
        },
      },
      height: Height { revision_height: 2709, revision_number: 0 },
      delay_time_period: 0,
      delay_block_period: 0,
      proof: merkle_proof,
      path: MerklePath {
        key_path: [
          #"696263",
          #"636f6d6d69746d656e74732f706f7274732f76657373656c6f7261636c652f6368616e6e656c732f6368616e6e656c2d312f73657175656e6365732f31",
        ],
      },
      value: #"aeb779503b62b553008521eee75d2082e1bf687fcc9406479a8246a8680d3be5",
    }

  let client_token =
    AuthToken {
      policy_id: client_minting_policy_id,
      name: #"c9fcf5b1fea9b80fe522703584970ab449b0e30bf2c9db6430",
    }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: ClientState {
          chain_id: "vesseloracle",
          trust_level: UncheckedRational { numerator: 1, denominator: 3 },
          trusting_period: 129600000000000,
          unbonding_period: 1814400000000000,
          max_clock_drift: 600000000000,
          frozen_height: Height { revision_number: 0, revision_height: 0 },
          latest_height: Height { revision_number: 0, revision_height: 2709 },
          proof_specs: [
            ProofSpec {
              leaf_spec: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
              },
              inner_spec: InnerSpec {
                child_order: [0, 1],
                child_size: 33,
                min_prefix_length: 4,
                max_prefix_length: 12,
                empty_child: #"",
                hash: 1,
              },
              max_depth: 0,
              min_depth: 0,
              prehash_key_before_comparison: False,
            },
            ProofSpec {
              leaf_spec: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
              },
              inner_spec: InnerSpec {
                child_order: [0, 1],
                child_size: 32,
                min_prefix_length: 1,
                max_prefix_length: 1,
                empty_child: #"",
                hash: 1,
              },
              max_depth: 0,
              min_depth: 0,
              prehash_key_before_comparison: False,
            },
          ],
        },
        consensus_states: [
          Pair(
            Height { revision_number: 0, revision_height: 98 },
            ConsensusState {
              timestamp: 1741254316161000000,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"db7b734824f145a1ada25a5605443a236caa4cd2b8664c9cd64066440232632a",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 386 },
            ConsensusState {
              timestamp: 1741254608959915587,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"d103d32226a3c0eae5b1590c556277ece79b93d95fecca2a2f7baea1dddeaa52",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 595 },
            ConsensusState {
              timestamp: 1741254823578866673,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"7637379e23567b1157e22786b847f2148c31d504e9934d34c6fac54ad8605f63",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 827 },
            ConsensusState {
              timestamp: 1741255060481338254,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"4a421aac294eafa063b32141fea479907463f81d00b0b164cafb76fe63437a99",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1012 },
            ConsensusState {
              timestamp: 1741255249952287676,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"783c76b484dfec3929cdb3cb356f31cef1c7f08062c95735488ead7231a41e7f",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1407 },
            ConsensusState {
              timestamp: 1741255663757617589,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"19ddee6c7a15832acb5f91ebd1dc1146eed655e9a7a1c981217e839d9f1292bd",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1513 },
            ConsensusState {
              timestamp: 1741255773199000209,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"53cec73099c727dfe0962baa54025dfd4fd405895585df636f81369f38fff200",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1720 },
            ConsensusState {
              timestamp: 1741256002709180093,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"f5f375c70dcf6d85ac74fcc179fd907de761139d0c0e002bd2f55a3e0ea29ff8",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1867 },
            ConsensusState {
              timestamp: 1741256153238979844,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"55c247e34affcd914cd5b0bd7d13eab3b6439393f337e72659a2532b5ddab6c0",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1976 },
            ConsensusState {
              timestamp: 1741256283594037584,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"35e5d4b87f662ef58276a2cded0997b55613496d79724f8d22f5ef84b79c1669",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2077 },
            ConsensusState {
              timestamp: 1741256386803412632,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"8310bbdcb3bfa53eed4328d78fa90d0af6a2b9fd53fc158ffa582dbb3a30454a",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2295 },
            ConsensusState {
              timestamp: 1741256616569878877,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"fcdf83d49544f7308dd6f59776d54ae791b0d999ed67851b04bb3be8ca80b436",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2491 },
            ConsensusState {
              timestamp: 1741256832126959713,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"eb43bb4b440a75cbafb37506c85461862b050c8d4d5e6d27a65a77cb30216a0f",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2709 },
            ConsensusState {
              timestamp: 1741257055001676886,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"3adc293f2faa9b848c7369430a8ef73377e30ffee1d686cda373c630cda43039",
              },
            },
          ),
        ],
      },
      token: client_token,
    }

  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: #"c9fcf5b1fea9b80fe522703584970ab449b0e30b19dd9b3030",
    }

  let connection_end =
    ConnectionEnd {
      client_id: "ibc_client-0",
      versions: [
        Version {
          identifier: "1",
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
      ],
      state: Open,
      counterparty: Counterparty {
        client_id: "2000-cardano-mithril-0",
        connection_id: "connection-0",
        prefix: MerklePrefix { key_prefix: "ibc" },
      },
      delay_period: 0,
    }

  let connection_datum =
    ConnectionDatum { state: connection_end, token: connection_token }

  let reference_inputs =
    [
      Input {
        output_reference: OutputReference {
          transaction_id: #"6b3714de8c991e2af1223c21631aab265cb743d191c2eeeca31f15a1cbaffe68",
          output_index: 0,
        },
        output: Output {
          address: from_script(connection_token.policy_id),
          value: from_asset(
            connection_token.policy_id,
            connection_token.name,
            1,
          ),
          datum: InlineDatum(connection_datum),
          reference_script: None,
        },
      },
      Input {
        output_reference: OutputReference {
          transaction_id: #"13622c6d8face49863462058aff580d05a9c6feef7d5b54581bb9d81c19feaba",
          output_index: 0,
        },
        output: Output {
          address: from_script(client_token.policy_id),
          value: from_asset(client_token.policy_id, client_token.name, 1),
          datum: InlineDatum(client_datum),
          reference_script: None,
        },
      },
    ]

  let spend_channel_redeemer: Redeemer =
    RecvPacket {
      packet: Packet {
        sequence: 1,
        source_port: "vesseloracle",
        source_channel: "channel-1",
        destination_port: "port-100",
        destination_channel: "channel-0",
        data: #"7b22696d6f223a2239353235333338222c227473223a313734313235353632322c22746f74616c53616d706c6573223a382c226574614f75746c69657273223a312c226574614d65616e436c65616e6564223a313732373639303339342c226574614d65616e416c6c223a313732373638373633332c22657461537464436c65616e6564223a34342c22657461537464416c6c223a313031372c22646570706f7274223a22494e4e5341222c22646570706f727453636f7265223a38377d",
        timeout_height: Height { revision_number: 1, revision_height: 2406 },
        timeout_timestamp: 1741267642158681752,
      },
      proof_commitment: merkle_proof,
      proof_height: Height { revision_height: 2709, revision_number: 0 },
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Mint(verify_proof_policy_id), mint_verifying_proof_redeemer),
      Pair(Spend(spend_channel_input.output_reference), spend_channel_redeemer),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: inputs,
      reference_inputs: reference_inputs,
      outputs: outputs,
      redeemers: redeemers,
      validity_range: validity_range,
    }

  recv_packet.recv_packet.mint(
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    verify_proof_policy_id,
    channel_token,
    recv_packet_policy_id,
    transaction,
  )
}
