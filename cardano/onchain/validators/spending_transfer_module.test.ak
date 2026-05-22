use aiken/fuzz
use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId, ada_asset_name, ada_policy_id, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, RefundVoucher,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/types/keys as transfer_module_keys
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, ChanOpenAck, ChanOpenConfirm, ChanOpenInit, ChanOpenTry,
  RecvPacket, SendPacket, TimeoutPacket,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnAcknowledgementPacket, OnChanCloseConfirm,
  OnChanCloseInit, OnChanOpenAck, OnChanOpenConfirm, OnChanOpenInit,
  OnChanOpenTry, OnRecvPacket, OnTimeoutPacket, Operator, TransferModuleData,
  TransferModuleOperator,
}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/testing/fuzz_dsl
use ibc/utils/string as string_utils
use spending_transfer_module

//=====================================Test================================================

type MockData {
  host_state_nft_policy_id: PolicyId,
  host_state_input: Input,
  host_state_output: Output,
  base_token: AuthToken,
  port_token: AuthToken,
  module_token: AuthToken,
  port_id: ByteArray,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  channel_id: ByteArray,
  module_output: Output,
  module_input: Input,
  channel_output: Output,
  channel_input: Input,
  proof_height: Height,
  proof: MerkleProof,
  cardano_public_key_hash: ByteArray,
  cosmos_address: ByteArray,
}

fn setup() -> MockData {
  let host_state_nft_policy_id: PolicyId = "mock host state nft policy id"
  let host_state_token_name = "ibc_host_state"
  let host_state_script_hash = "mock host_state_stt_script_hash"

  let host_state_output =
    Output {
      address: from_script(host_state_script_hash),
      value: from_asset(host_state_nft_policy_id, host_state_token_name, 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let host_state_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
        output_index: 0,
      },
      output: host_state_output,
    }

  let base_token =
    AuthToken {
      policy_id: "mock base token policy_id",
      name: "mock base token name",
    }

  let port_token =
    AuthToken {
      policy_id: "mock port token policy_id",
      name: "mock port token name",
    }

  let module_token =
    AuthToken {
      policy_id: "mock module token policy_id",
      name: "mock module token name",
    }

  let port_id = "port-1"

  let transfer_escrow_shard_policy_id = "mock transfer escrow shard policy id"

  let channel_minting_policy_id = "mock channel minting policy id"

  let voucher_minting_policy_id = "mock voucher minting policy id"

  let channel_id = "channel-0"

  let module_output =
    Output {
      address: from_script("mock module script hash"),
      value: from_asset(module_token.policy_id, module_token.name, 1)
        |> add(port_token.policy_id, port_token.name, 1)
        |> add(ada_policy_id, ada_asset_name, 99999999999),
      datum: NoDatum,
      reference_script: None,
    }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: module_output,
    }

  expect channel_keys.is_valid_channel_id(channel_id)

  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)

  let channel_token_name =
    auth.generate_token_name(
      AuthToken {
        policy_id: host_state_nft_policy_id,
        name: host_state_token_name,
      },
      channel_keys.channel_prefix,
      channel_sequence,
    )

  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  let channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: Channel {
          state: chan_state_mod.Init,
          ordering: chan_order_mod.Unordered,
          counterparty: ChannelCounterparty { port_id: "", channel_id: "" },
          connection_hops: [],
          version: transfer_module_keys.version,
        },
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id,
      token: channel_token,
    }

  let output_channel_datum =
    ChannelDatum {
      ..channel_datum,
      state: ChannelDatumState {
        ..channel_datum.state,
        packet_receipt: [Pair(1, ""), ..channel_datum.state.packet_receipt],
        packet_acknowledgement: [
          Pair(
            1,
            #"08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c",
          ),
          ..channel_datum.state.packet_acknowledgement
        ],
      },
    }

  let channel_output =
    Output {
      address: from_script("mock channel script hash"),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(output_channel_datum),
      reference_script: None,
    }

  let channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"c936c81864dde93b47d2b98e7de9d988e0c2c9640da198e19462407670252cf9",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock channel script hash"),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(channel_datum),
        reference_script: None,
      },
    }

  let proof_height = Height { revision_number: 1, revision_height: 14 }

  let proof =
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

  //525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22
  let cardano_public_key_hash =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let cosmos_address = "mock cosmos address"

  MockData {
    host_state_nft_policy_id,
    host_state_input,
    host_state_output,
    base_token,
    port_token,
    module_token,
    port_id,
    transfer_escrow_shard_policy_id,
    channel_minting_policy_id,
    voucher_minting_policy_id,
    channel_id,
    module_output,
    module_input,
    channel_output,
    channel_input,
    proof_height,
    proof,
    cardano_public_key_hash,
    cosmos_address,
  }
}

fn transfer_escrow_input(
  output_index: Int,
  module_output: Output,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
  amount: Int,
) -> Input {
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  Input {
    output_reference: OutputReference {
      transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      output_index,
    },
    output: Output {
      address: module_output.address,
      value: from_asset(ada_policy_id, ada_asset_name, amount)
        |> add(transfer_escrow_shard_policy_id, shard_token_name, 1),
      datum: InlineDatum(TransferEscrowDatum { channel_id, denom }),
      reference_script: None,
    },
  }
}

fn transfer_escrow_output(
  module_output: Output,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
  amount: Int,
) -> Output {
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  Output {
    address: module_output.address,
    value: from_asset(ada_policy_id, ada_asset_name, amount)
      |> add(transfer_escrow_shard_policy_id, shard_token_name, 1),
    datum: InlineDatum(TransferEscrowDatum { channel_id, denom }),
    reference_script: None,
  }
}

fn transfer_native_asset_escrow_input(
  output_index: Int,
  module_output: Output,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
  token_policy_id: PolicyId,
  token_name: ByteArray,
  amount: Int,
) -> Input {
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  Input {
    output_reference: OutputReference {
      transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      output_index,
    },
    output: Output {
      address: module_output.address,
      value: from_asset(token_policy_id, token_name, amount)
        |> add(transfer_escrow_shard_policy_id, shard_token_name, 1),
      datum: InlineDatum(TransferEscrowDatum { channel_id, denom }),
      reference_script: None,
    },
  }
}

fn transfer_native_asset_escrow_output(
  module_output: Output,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
  token_policy_id: PolicyId,
  token_name: ByteArray,
  amount: Int,
) -> Output {
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  Output {
    address: module_output.address,
    value: from_asset(token_policy_id, token_name, amount)
      |> add(transfer_escrow_shard_policy_id, shard_token_name, 1),
    datum: InlineDatum(TransferEscrowDatum { channel_id, denom }),
    reference_script: None,
  }
}

fn native_asset_denom() -> ByteArray {
  "61616161"
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("61616161")
    |> bytearray.concat("636f696e")
}

fn build_packet(
  denom: ByteArray,
  amount: Int,
  sender: ByteArray,
  receiver: ByteArray,
  source_port: ByteArray,
  source_channel: ByteArray,
  destination_port: ByteArray,
  destination_channel: ByteArray,
) -> (FungibleTokenPacketData, Packet) {
  let amount = string.from_int(amount) |> string.to_bytearray()

  let ftpd =
    FungibleTokenPacketData { denom, amount, sender, receiver, memo: "" }

  let packet =
    Packet {
      sequence: 1,
      source_port,
      source_channel,
      destination_port,
      destination_channel,
      data: fungible_token_packet_data.get_bytes(ftpd),
      timeout_height: height.zero_height(),
      timeout_timestamp: 1111,
    }

  (ftpd, packet)
}

fn run_transfer_module_transition(
  mock: MockData,
  transaction: Transaction,
  module_redeemer: IBCModuleRedeemer,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  fuzz_dsl.protocol_tx_from_transaction(
    fuzz_dsl.model("transfer", "module"),
    fuzz_dsl.model("transfer", "module.after"),
    mutation,
    transaction,
  )
    |> fuzz_dsl.with_protocol_validator_check(
        "spending_transfer_module",
        spending_transfer_module.spend_transfer_module.spend(
          mock.port_token,
          mock.module_token,
          mock.port_id,
          mock.transfer_escrow_shard_policy_id,
          mock.channel_minting_policy_id,
          mock.voucher_minting_policy_id,
          [],
          mock.host_state_nft_policy_id,
          None,
          module_redeemer,
          mock.module_input.output_reference,
          transaction,
        ),
      )
}

fn native_send_escrow_fixture(
  escrow_amount: Int,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let transfer_amount = 1234
  let receiver = mock.cardano_public_key_hash
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let source_port = "port-0"
  let source_channel = "channel-0"
  let denom = "6c6f76656c616365"
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(mock.channel_id, denom)
  let escrow_output =
    transfer_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      denom,
      escrow_amount,
    )
  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      mock.host_state_output,
    ]
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )
  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )
  let channel_redeemer: Redeemer = SendPacket { packet }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        1,
      ),
    }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn recv_source_unescrow_fixture(
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let transfer_amount = 1234
  let receiver = mock.cardano_public_key_hash
  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)
  let receiver_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(ada_policy_id, ada_asset_name, transfer_amount),
      datum: NoDatum,
      reference_script: None,
    }
  let outputs =
    [
      mock.module_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let source_port = "port-0"
  let source_channel = "channel-0"
  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("6c6f76656c616365")
  let escrow_input =
    transfer_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      "6c6f76656c616365",
      transfer_amount,
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(mock.channel_id, "6c6f76656c616365")
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )
  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        -1,
      ),
    }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn timeout_unescrow_fixture(
  refund_amount: Int,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let transfer_amount = 1234
  let sender = mock.cardano_public_key_hash
  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)
  let receiver_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: from_asset(
        ada_policy_id,
        ada_asset_name,
        refund_amount + 1_000_000,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let outputs =
    [
      mock.module_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]
  let source_port = "port-0"
  let source_channel = "channel-0"
  let denom = "6c6f76656c616365"
  let escrow_input =
    transfer_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      source_channel,
      denom,
      transfer_amount,
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(source_channel, denom)
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )
  let module_redeemer: Redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: mock.channel_id,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        -1,
      ),
    }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn native_asset_timeout_fixture(
  receiver_amount: Int,
  remaining_escrow_amount: Int,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let transfer_amount = 100
  let input_escrow_amount = 150
  let sender = mock.cardano_public_key_hash
  let native_policy_id: PolicyId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let native_token_name = "coin"
  let denom = native_asset_denom()
  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)
  let receiver_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: from_asset(native_policy_id, native_token_name, receiver_amount),
      datum: NoDatum,
      reference_script: None,
    }
  let escrow_input =
    transfer_native_asset_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      "channel-0",
      denom,
      native_policy_id,
      native_token_name,
      input_escrow_amount,
    )
  let escrow_output =
    transfer_native_asset_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      "channel-0",
      denom,
      native_policy_id,
      native_token_name,
      remaining_escrow_amount,
    )
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )
  let module_redeemer: Redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: mock.channel_id,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn ack_success_fixture(
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let receiver = mock.cardano_public_key_hash
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]
  let source_port = mock.port_id
  let source_channel = mock.channel_id
  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")
  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: TransferModuleData(ftpd),
      },
    )
  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)
  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn voucher_send_burn_fixture(
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let transfer_amount = 1234
  let receiver = mock.cardano_public_key_hash
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]
  let source_port = mock.port_id
  let source_channel = mock.channel_id
  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )
  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )
  let channel_redeemer: Redeemer = SendPacket { packet }
  let mint_voucher_redeemer: Redeemer =
    BurnVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data: ftpd,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn voucher_recv_sink_fixture(
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let (ftpd, packet) =
    build_packet(
      "atom",
      1234,
      mock.cosmos_address,
      mock.cardano_public_key_hash,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )
  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }
  let mint_voucher_redeemer: Redeemer =
    MintVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      packet_dest_port: packet.destination_port,
      packet_dest_channel: packet.destination_channel,
      data: ftpd,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

fn voucher_error_ack_refund_fixture(
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  let mock = setup()
  let receiver = mock.cardano_public_key_hash
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]
  let source_port = mock.port_id
  let source_channel = mock.channel_id
  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")
  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )
  let acknowledgement = acknowledgement_mod.new_error_acknowledgement("")
  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: TransferModuleData(ftpd),
      },
    )
  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)
  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }
  let mint_voucher_redeemer: Redeemer =
    RefundVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data: ftpd,
      acknowledgement: Some(acknowledgement),
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }
  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  run_transfer_module_transition(mock, transaction, module_redeemer, mutation)
}

test prop_transfer_module_native_send_escrow_increases_exactly(
  _seed via fuzz.int(),
) {
  fuzz.label(
    @"regression.contract.transfer.native_send.escrow_increases_exactly",
  )

  // Native SendPacket should move exactly the sent amount into escrow. This is
  // the positive baseline that the value-delta mutations below deviate from.
  native_send_escrow_fixture(1234, fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_native_send_rejects_wrong_escrow_delta(
  _seed via fuzz.int(),
) fail {
  fuzz.label(
    @"regression.contract.transfer.invalid_wrong_escrow_delta_rejected",
  )

  // One-lovelace-short escrow is near-valid enough to exercise the same path,
  // but it must fail because transfer accounting is exact, not lower-bound.
  native_send_escrow_fixture(1233, fuzz_dsl.mutation("wrong_escrow_delta"))
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_recv_source_unescrows_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.transfer.recv_source.unescrows_exactly")

  // Source-chain receive releases escrow instead of minting voucher supply.
  recv_source_unescrow_fixture(fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_native_timeout_refunds_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.transfer.native_timeout.refund_exactly")

  // Timeout on native escrow should restore the original sender balance exactly.
  timeout_unescrow_fixture(1234, fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_native_timeout_rejects_wrong_refund_amount(
  _seed via fuzz.int(),
) fail {
  fuzz.label(
    @"regression.contract.transfer.invalid_wrong_native_refund_amount_rejected",
  )

  // Wrong refund amount is a fund-moving bug class; the mutation keeps the rest
  // of the timeout shape valid so the amount check is the decisive guard.
  native_asset_timeout_fixture(
    99,
    50,
    fuzz_dsl.mutation("wrong_native_refund_amount"),
  )
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_native_ack_has_no_refund(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.transfer.native_ack.no_refund")

  // Successful ack confirms delivery; it must not also refund native escrow.
  ack_success_fixture(fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_voucher_send_burns_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.transfer.voucher_send.burns_exactly")

  // Sending a voucher back toward its source burns voucher supply rather than
  // increasing native escrow.
  voucher_send_burn_fixture(fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_recv_sink_mints_voucher_exactly(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.transfer.recv_sink.mints_voucher_exactly")

  // Sink-chain receive creates voucher supply only for the packet amount.
  voucher_recv_sink_fixture(fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test prop_transfer_module_voucher_error_ack_remints_exactly(
  _seed via fuzz.int(),
) {
  fuzz.label(@"regression.contract.transfer.voucher_error_ack.remints_exactly")

  // Error ack reverses a voucher send by reminting the burned voucher amount.
  voucher_error_ack_refund_fixture(fuzz_dsl.no_mutation())
    |> fuzz_dsl.assert_protocol_valid
}

test on_chan_open_init_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenInit { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer = ChanOpenInit

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Mint(mock.channel_minting_policy_id), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_chan_open_init_fails_without_host_state_co_spend() fail {
  let mock = setup()

  // Same transaction as `on_chan_open_init_succeed`, but without the HostState input/output.
  let inputs = [mock.module_input]
  let outputs = [mock.module_output, mock.channel_output]

  let module_redeemer: Redeemer =
    Callback(OnChanOpenInit { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer = ChanOpenInit

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Mint(mock.channel_minting_policy_id), channel_redeemer),
    ]

  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_chan_open_try_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenTry { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenTry {
      counterparty_version: transfer_module_keys.version,
      proof_init: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Mint(mock.channel_minting_policy_id), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_chan_open_ack_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenAck { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenAck {
      counterparty_version: transfer_module_keys.version,
      proof_try: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_chan_open_confirm_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenConfirm { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenConfirm { proof_ack: mock.proof, proof_height: mock.proof_height }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_recv_packet_mint_voucher_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")

  let (ftpd, packet) =
    build_packet(
      "atom",
      1234,
      mock.cosmos_address,
      mock.cardano_public_key_hash,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }

  let mint_voucher_redeemer: Redeemer =
    MintVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      packet_dest_port: packet.destination_port,
      packet_dest_channel: packet.destination_channel,
      data: ftpd,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_recv_packet_unescrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let receiver_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(ada_policy_id, ada_asset_name, transfer_amount),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [
      mock.module_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]

  //==========================arrange redeemers=========================
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")

  let source_port = "port-0"
  let source_channel = "channel-0"

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("6c6f76656c616365")

  //==========================arrange inputs=========================
  let escrow_input =
    transfer_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      "6c6f76656c616365",
      transfer_amount,
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(mock.channel_id, "6c6f76656c616365")
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        -1,
      ),
    }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_recv_packet_unescrow_fail_unwanted_voucher() fail {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let receiver_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(ada_policy_id, ada_asset_name, transfer_amount),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [
      mock.module_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]

  //==========================arrange redeemers=========================
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")

  let source_port = "port-0"
  let source_channel = "channel-0"

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("6c6f76656c616365")

  //==========================arrange inputs=========================
  let escrow_input =
    transfer_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      "6c6f76656c616365",
      transfer_amount,
    )
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }

  let mint_voucher_redeemer: Redeemer =
    MintVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      packet_dest_port: packet.destination_port,
      packet_dest_channel: packet.destination_channel,
      data: ftpd,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test transfer_escrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange redeemers=========================
  let source_port = "port-0"
  let source_channel = "channel-0"

  // lovelace
  let denom = "6c6f76656c616365"
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(mock.channel_id, denom)

  //==========================arrange outputs=========================
  let escrow_output =
    transfer_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      denom,
      transfer_amount,
    )

  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      mock.host_state_output,
    ]

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )

  let channel_redeemer: Redeemer = SendPacket { packet }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        1,
      ),
    }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test transfer_escrow_native_asset_fails_with_short_created_shard() fail {
  let mock = setup()
  let transfer_amount = 1234
  let receiver = mock.cardano_public_key_hash
  let native_policy_id: PolicyId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let native_token_name = "coin"
  let denom = native_asset_denom()
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(mock.channel_id, denom)

  let escrow_output =
    transfer_native_asset_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      denom,
      native_policy_id,
      native_token_name,
      transfer_amount - 1,
    )

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )

  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )
  let channel_redeemer: Redeemer = SendPacket { packet }
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      mock.host_state_output,
    ]
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        1,
      ),
    }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer
  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test transfer_escrow_native_asset_fails_with_extra_created_shard() fail {
  let mock = setup()
  let transfer_amount = 1234
  let receiver = mock.cardano_public_key_hash
  let native_policy_id: PolicyId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let native_token_name = "coin"
  let denom = native_asset_denom()
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(mock.channel_id, denom)

  let escrow_output =
    transfer_native_asset_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      denom,
      native_policy_id,
      native_token_name,
      transfer_amount + 1,
    )

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )

  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )
  let channel_redeemer: Redeemer = SendPacket { packet }
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      mock.host_state_output,
    ]
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        1,
      ),
    }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer
  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test transfer_burn_voucher_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )

  let channel_redeemer: Redeemer = SendPacket { packet }

  let mint_voucher_redeemer: Redeemer =
    BurnVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data: ftpd,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_timeout_packet_mint_voucher_succeed() {
  let mock = setup()

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id: mock.channel_id, data: packet_data })

  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }

  let mint_voucher_redeemer: Redeemer =
    RefundVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data: ftpd,
      acknowledgement: None,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_timeout_packet_unescrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let sender = mock.cardano_public_key_hash

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let receiver_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: from_asset(
        ada_policy_id,
        ada_asset_name,
        transfer_amount + 1_000_000,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [
      mock.module_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]

  //==========================arrange redeemers=========================
  let source_port = "port-0"
  let source_channel = "channel-0"

  // lovelace
  let denom = "6c6f76656c616365"

  //==========================arrange inputs=========================
  let escrow_input =
    transfer_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      source_channel,
      denom,
      transfer_amount,
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(source_channel, denom)
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id: mock.channel_id, data: packet_data })

  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        -1,
      ),
    }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_timeout_packet_native_refund_fails_with_wrong_escrow_delta() fail {
  let mock = setup()
  let transfer_amount = 100
  let remaining_escrow = 50
  let sender = mock.cardano_public_key_hash
  let native_policy_id: PolicyId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let native_token_name = "coin"
  let denom = native_asset_denom()

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)
  let receiver_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: from_asset(native_policy_id, native_token_name, transfer_amount),
      datum: NoDatum,
      reference_script: None,
    }
  let escrow_input =
    transfer_native_asset_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      "channel-0",
      denom,
      native_policy_id,
      native_token_name,
      transfer_amount + remaining_escrow,
    )
  let escrow_output =
    transfer_native_asset_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      "channel-0",
      denom,
      native_policy_id,
      native_token_name,
      remaining_escrow + 1,
    )
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]
  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )
  let packet_data = TransferModuleData(ftpd)
  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id: mock.channel_id, data: packet_data })
  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer
  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_recv_packet_source_fails_with_short_native_payout() fail {
  let mock = setup()
  let transfer_amount = 100
  let remaining_escrow = 50
  let receiver = mock.cardano_public_key_hash
  let native_policy_id: PolicyId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let native_token_name = "coin"
  let denom = native_asset_denom()

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)
  let receiver_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(
        native_policy_id,
        native_token_name,
        transfer_amount - 1,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let source_port = "port-0"
  let source_channel = "channel-0"
  let prefixed_denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat(denom)
  let escrow_input =
    transfer_native_asset_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      denom,
      native_policy_id,
      native_token_name,
      transfer_amount + remaining_escrow,
    )
  let escrow_output =
    transfer_native_asset_escrow_output(
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      mock.channel_id,
      denom,
      native_policy_id,
      native_token_name,
      remaining_escrow,
    )
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]
  let outputs =
    [
      mock.module_output,
      escrow_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let (ftpd, packet) =
    build_packet(
      prefixed_denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )
  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer
  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_acknowledgement_packet_result_succeed() {
  let mock = setup()

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)

  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_acknowledgement_packet_error_mint_voucher_succeed() {
  let mock = setup()

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs = [mock.module_input, mock.channel_input, mock.host_state_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output, mock.host_state_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let acknowledgement = acknowledgement_mod.new_error_acknowledgement("")

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)

  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }

  let mint_voucher_redeemer: Redeemer =
    RefundVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      data: ftpd,
      acknowledgement: Some(acknowledgement),
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock.voucher_minting_policy_id), mint_voucher_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_acknowledgement_packet_error_unescrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let sender = mock.cardano_public_key_hash

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let receiver_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: from_asset(ada_policy_id, ada_asset_name, transfer_amount),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [
      mock.module_output,
      mock.channel_output,
      receiver_output,
      mock.host_state_output,
    ]

  //==========================arrange redeemers=========================
  let source_port = "port-0"
  let source_channel = "channel-0"

  // lovelace
  let denom = "6c6f76656c616365"

  //==========================arrange inputs=========================
  let escrow_input =
    transfer_escrow_input(
      1,
      mock.module_output,
      mock.transfer_escrow_shard_policy_id,
      source_channel,
      denom,
      transfer_amount,
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(source_channel, denom)
  let inputs =
    [mock.module_input, escrow_input, mock.channel_input, mock.host_state_input]

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let acknowledgement = acknowledgement_mod.new_error_acknowledgement("")

  // let acknowledgement = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)

  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.module_input.output_reference), module_redeemer),
      Pair(Spend(mock.channel_input.output_reference), channel_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      outputs,
      redeemers,
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        shard_token_name,
        -1,
      ),
    }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.transfer_escrow_shard_policy_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    [],
    mock.host_state_nft_policy_id,
    None,
    module_redeemer,
    mock.module_input.output_reference,
    transaction,
  )
}

test on_chan_close_init_given_any_input_returns_false() {
  let fake_data = setup()

  //==========================arrange inputs=========================
  let inputs = [fake_data.module_input, fake_data.host_state_input]

  //==========================arrange outputs=========================
  let module_output = fake_data.module_input.output

  let outputs = [module_output, fake_data.host_state_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanCloseInit { channel_id: fake_data.channel_id })

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [Pair(Spend(fake_data.module_input.output_reference), module_redeemer)]
  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    fake_data.port_token,
    fake_data.module_token,
    fake_data.port_id,
    fake_data.transfer_escrow_shard_policy_id,
    fake_data.channel_minting_policy_id,
    fake_data.voucher_minting_policy_id,
    [],
    fake_data.host_state_nft_policy_id,
    None,
    module_redeemer,
    fake_data.module_input.output_reference,
    transaction,
  ) == False
}

test on_chan_close_confirm_given_any_input_returns_false() {
  let fake_data = setup()

  //==========================arrange inputs=========================
  let inputs = [fake_data.module_input, fake_data.host_state_input]

  //==========================arrange outputs=========================
  let module_output = fake_data.module_input.output

  let outputs = [module_output, fake_data.host_state_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanCloseConfirm { channel_id: fake_data.channel_id })

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [Pair(Spend(fake_data.module_input.output_reference), module_redeemer)]
  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, redeemers }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spending_transfer_module.spend_transfer_module.spend(
    fake_data.port_token,
    fake_data.module_token,
    fake_data.port_id,
    fake_data.transfer_escrow_shard_policy_id,
    fake_data.channel_minting_policy_id,
    fake_data.voucher_minting_policy_id,
    [],
    fake_data.host_state_nft_policy_id,
    None,
    module_redeemer,
    fake_data.module_input.output_reference,
    transaction,
  ) == False
}
