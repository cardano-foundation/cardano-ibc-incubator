use aiken/builtin
use aiken/crypto
use aiken/fuzz
use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use ibc/apps/transfer/bridge_registry.{BridgeDeployment, BridgeRegistryDatum}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer, RefundVoucher,
}
use ibc/apps/transfer/trace_registry.{
  Directory, InsertTrace, Shard, TraceRegistryDatum,
  TraceRegistryDirectoryBucket, TraceRegistryDirectoryDatum, TraceRegistryEntry,
  TraceRegistryRedeemer, TraceRegistryShardDatum, bucket_index_for_hash,
}
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/voucher_asset_name
use ibc/apps/transfer/voucher_metadata
use ibc/apps/transfer/voucher_policy_memo
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, RecvPacket, SendPacket, TimeoutPacket,
}
use ibc/core/ics_004/types/acknowledgement
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket, OnRecvPacket, OnTimeoutPacket, Operator,
  TransferModuleData, TransferModuleOperator,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/testing/fuzz_dsl
use ibc/utils/string as string_utils
use minting_voucher
use trace_registry as trace_registry_validator

type MockData {
  module_token: AuthToken,
  directory_auth_token: AuthToken,
  voucher_minting_policy_id: PolicyId,
  voucher_metadata_script_hash: crypto.ScriptHash,
  channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  bridge_registry_token: AuthToken,
  bridge_registry_input: Input,
  module_input: Input,
}

type FirstSeenVoucherFixture {
  FirstSeenVoucherFixture {
    mock_data: MockData,
    redeemer: MintVoucherRedeemer,
    transaction: Transaction,
    mutation: fuzz_dsl.Mutation,
    trace_registry_datum: TraceRegistryDatum,
    trace_registry_redeemer: TraceRegistryRedeemer,
    trace_registry_spent_output_ref: OutputReference,
  }
}

fn prepare_mock_data() -> MockData {
  let module_token =
    AuthToken { policy_id: "module token policy id", name: "module token name" }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("spend module output address"),
        value: from_asset(module_token.policy_id, module_token.name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }

  MockData {
    module_token,
    directory_auth_token: AuthToken {
      policy_id: "trace shard policy id",
      name: "dir",
    },
    voucher_minting_policy_id: "mint voucher policy id",
    voucher_metadata_script_hash: "voucher metadata script hash",
    channel_minting_policy_id: "mint channel policy id",
    host_state_nft_policy_id: "host state nft policy id",
    bridge_registry_token: AuthToken {
      policy_id: "bridge registry policy id",
      name: "bridge registry token name",
    },
    bridge_registry_input: make_bridge_registry_input(
      AuthToken {
        policy_id: "bridge registry policy id",
        name: "bridge registry token name",
      },
      "mint channel policy id",
      "host state nft policy id",
      "mint voucher policy id",
      [],
    ),
    module_input,
  }
}

fn make_bridge_registry_input(
  registry_token: AuthToken,
  channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  active_voucher_policy_id: PolicyId,
  legacy_voucher_policy_ids: List<PolicyId>,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"50b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 9,
    },
    output: Output {
      address: from_script("bridge registry script hash"),
      value: from_asset(registry_token.policy_id, registry_token.name, 1),
      datum: InlineDatum(
        BridgeRegistryDatum {
          active_deployment: BridgeDeployment {
            host_state_nft_policy_id,
            channel_minting_policy_id,
          },
          active_voucher_policy_id,
          legacy_voucher_policy_ids,
          governance_key_hash: #"00000000000000000000000000000000000000000000000000000000",
        },
      ),
      reference_script: None,
    },
  }
}

fn make_channel_input(
  channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  channel_id: ByteArray,
) -> Input {
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let host_state_nft =
    AuthToken {
      policy_id: host_state_nft_policy_id,
      name: host_state_token_name,
    }
  let channel_token_name =
    auth.generate_token_name(
      host_state_nft,
      channel_keys.channel_prefix,
      channel_sequence,
    )

  Input {
    output_reference: OutputReference {
      transaction_id: #"47b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 3,
    },
    output: Output {
      address: from_script("channel script hash"),
      value: from_asset(channel_minting_policy_id, channel_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn make_packet(
  source_port: ByteArray,
  source_channel: ByteArray,
  destination_port: ByteArray,
  destination_channel: ByteArray,
  data: ByteArray,
) -> Packet {
  Packet {
    sequence: 1,
    source_port,
    source_channel,
    destination_port,
    destination_channel,
    data,
    timeout_height: Height { revision_number: 1, revision_height: 1 },
    timeout_timestamp: 0,
  }
}

fn mock_proof() -> MerkleProof {
  MerkleProof { proofs: [] }
}

fn make_directory_input(
  directory_auth_token: AuthToken,
  bucket_index: Int,
  active_shard_name: ByteArray,
) -> Input {
  make_directory_input_with_archived(
    directory_auth_token,
    bucket_index,
    active_shard_name,
    [],
  )
}

fn make_directory_input_with_archived(
  directory_auth_token: AuthToken,
  bucket_index: Int,
  active_shard_name: ByteArray,
  archived_shard_names: List<ByteArray>,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"17b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    },
    output: Output {
      address: from_script("trace registry script hash"),
      value: from_asset(
        directory_auth_token.policy_id,
        directory_auth_token.name,
        1,
      ),
      datum: InlineDatum(
        Directory(
          TraceRegistryDirectoryDatum {
            buckets: [
              TraceRegistryDirectoryBucket {
                bucket_index,
                active_shard_name,
                archived_shard_names,
              },
            ],
          },
        ),
      ),
      reference_script: None,
    },
  }
}

fn make_shard_reference_input(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Input {
  make_shard_reference_input_with_output_index(
    shard_policy_id,
    shard_name,
    bucket_index,
    voucher_hash,
    full_denom,
    1,
  )
}

fn make_shard_reference_input_with_output_index(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
  output_index: Int,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"27b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index,
    },
    output: Output {
      address: from_script("trace registry script hash"),
      value: from_asset(shard_policy_id, shard_name, 1),
      datum: InlineDatum(
        Shard(
          TraceRegistryShardDatum {
            bucket_index,
            entries: [TraceRegistryEntry { voucher_hash, full_denom }],
          },
        ),
      ),
      reference_script: None,
    },
  }
}

fn make_shard_spend_input(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"37b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 2,
    },
    output: Output {
      address: from_script("trace registry script hash"),
      value: from_asset(shard_policy_id, shard_name, 1),
      datum: InlineDatum(
        Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
      ),
      reference_script: None,
    },
  }
}

fn make_shard_output(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Output {
  Output {
    address: from_script("trace registry script hash"),
    value: from_asset(shard_policy_id, shard_name, 1),
    datum: InlineDatum(
      Shard(
        TraceRegistryShardDatum {
          bucket_index,
          entries: [TraceRegistryEntry { voucher_hash, full_denom }],
        },
      ),
    ),
    reference_script: None,
  }
}

fn make_metadata_output(
  voucher_metadata_script_hash: crypto.ScriptHash,
  full_denom: ByteArray,
  voucher_policy_id: PolicyId,
  voucher_token_name: ByteArray,
  reference_token_name: ByteArray,
) -> Output {
  make_metadata_output_with_datum(
    voucher_metadata_script_hash,
    voucher_policy_id,
    reference_token_name,
    voucher_metadata.build_datum(
      full_denom,
      voucher_token_name,
      voucher_policy_id,
    ),
  )
}

fn make_metadata_output_with_datum(
  voucher_metadata_script_hash: crypto.ScriptHash,
  voucher_policy_id: PolicyId,
  reference_token_name: ByteArray,
  metadata_datum: Data,
) -> Output {
  Output {
    address: from_script(voucher_metadata_script_hash),
    value: from_asset(voucher_policy_id, reference_token_name, 1),
    datum: InlineDatum(metadata_datum),
    reference_script: None,
  }
}

fn make_metadata_reference_input(
  voucher_metadata_script_hash: crypto.ScriptHash,
  full_denom: ByteArray,
  voucher_policy_id: PolicyId,
  voucher_token_name: ByteArray,
  reference_token_name: ByteArray,
  output_index: Int,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"60b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index,
    },
    output: make_metadata_output(
      voucher_metadata_script_hash,
      full_denom,
      voucher_policy_id,
      voucher_token_name,
      reference_token_name,
    ),
  }
}

fn metadata_description(denom: ByteArray) -> ByteArray {
  bytearray.concat("IBC voucher for ", denom)
}

fn hex_ascii(bytes: ByteArray) -> ByteArray {
  bytes
    |> bytearray.to_hex
    |> string.to_bytearray
    |> ascii_lower
}

fn ascii_lower(bytes: ByteArray) -> ByteArray {
  bytearray.foldr(
    bytes,
    "",
    fn(byte, acc) {
      bytearray.push(
        acc,
        if byte >= 65 && byte <= 90 {
          byte + 32
        } else {
          byte
        },
      )
    },
  )
}

fn custom_metadata_datum(
  name: ByteArray,
  ticker: ByteArray,
  description: ByteArray,
  full_denom: ByteArray,
  voucher_policy_id: PolicyId,
  voucher_token_name: ByteArray,
) -> Data {
  let metadata_map =
    builtin.map_data(
      [
        Pair(builtin.b_data("name"), builtin.b_data(name)),
        Pair(builtin.b_data("ticker"), builtin.b_data(ticker)),
        Pair(builtin.b_data("description"), builtin.b_data(description)),
      ],
    )
  let extra_map =
    builtin.map_data(
      [
        Pair(builtin.b_data("path"), builtin.b_data("port-99/channel-99")),
        Pair(builtin.b_data("baseDenom"), builtin.b_data("ibc/usdt")),
        Pair(builtin.b_data("fullDenom"), builtin.b_data(full_denom)),
        Pair(
          builtin.b_data("ibcDenomHash"),
          builtin.b_data(crypto.sha2_256(full_denom) |> hex_ascii),
        ),
        Pair(builtin.b_data("traceVersion"), builtin.i_data(1)),
        Pair(
          builtin.b_data("voucherPolicyId"),
          builtin.b_data(hex_ascii(voucher_policy_id)),
        ),
        Pair(
          builtin.b_data("voucherTokenName"),
          builtin.b_data(hex_ascii(voucher_token_name)),
        ),
      ],
    )

  builtin.constr_data(0, [metadata_map, builtin.i_data(1), extra_map])
}

fn first_seen_voucher_fixture(
  metadata_output: Output,
  mutation: fuzz_dsl.Mutation,
) -> FirstSeenVoucherFixture {
  let mock_data = prepare_mock_data()
  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"
  let transfer_amount = 100
  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"
  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }
  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }
  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let active_shard_input =
    make_shard_spend_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: TransferModuleData(ftpd),
      },
    )
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer
  let trace_registry_redeemer_in_data: Redeemer =
    InsertTrace { voucher_hash: voucher_denom_hash, full_denom: prefixed_denom }
  let trace_registry_redeemer =
    InsertTrace { voucher_hash: voucher_denom_hash, full_denom: prefixed_denom }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(
        Mint(mock_data.voucher_minting_policy_id),
        mint_voucher_redeemer_in_data,
      ),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
      Pair(
        Spend(channel_input.output_reference),
        spend_channel_redeemer_in_data,
      ),
      Pair(
        Spend(active_shard_input.output_reference),
        trace_registry_redeemer_in_data,
      ),
    ]
  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
      |> assets.add(
          mock_data.voucher_minting_policy_id,
          reference_token_name,
          1,
        )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)
  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let updated_shard_output =
    make_shard_output(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      prefixed_denom,
    )
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input, active_shard_input],
      reference_inputs: [directory_input, mock_data.bridge_registry_input],
      outputs: [voucher_output, metadata_output, updated_shard_output],
      redeemers,
      mint,
    }

  FirstSeenVoucherFixture {
    mock_data,
    redeemer: mint_voucher_redeemer,
    transaction,
    mutation,
    trace_registry_datum: Shard(
      TraceRegistryShardDatum { bucket_index, entries: [] },
    ),
    trace_registry_redeemer,
    trace_registry_spent_output_ref: active_shard_input.output_reference,
  }
}

fn canonical_first_seen_metadata_output() -> Output {
  let mock_data = prepare_mock_data()
  let full_denom = "port-99/channel-99/ibc/usdt"
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  make_metadata_output(
    mock_data.voucher_metadata_script_hash,
    full_denom,
    mock_data.voucher_minting_policy_id,
    token_name,
    reference_token_name,
  )
}

fn mutated_first_seen_metadata_output(
  metadata_datum: Data,
  metadata_policy_id: PolicyId,
  reference_token_name: ByteArray,
) -> Output {
  let mock_data = prepare_mock_data()

  make_metadata_output_with_datum(
    mock_data.voucher_metadata_script_hash,
    metadata_policy_id,
    reference_token_name,
    metadata_datum,
  )
}

fn run_first_seen_voucher_mint_transition(
  fixture: FirstSeenVoucherFixture,
) -> fuzz_dsl.ProtocolTxFixture {
  fuzz_dsl.protocol_tx_from_transaction(
    fuzz_dsl.model("voucher", "first_mint"),
    fuzz_dsl.model("voucher", "first_mint.after"),
    fixture.mutation,
    fixture.transaction,
  )
    |> fuzz_dsl.with_protocol_validator_check(
        "minting_voucher",
        minting_voucher.mint_voucher.mint(
          fixture.mock_data.module_token,
          fixture.mock_data.directory_auth_token,
          fixture.mock_data.voucher_metadata_script_hash,
          fixture.mock_data.bridge_registry_token,
          fixture.redeemer,
          fixture.mock_data.voucher_minting_policy_id,
          fixture.transaction,
        ),
      )
}

fn run_first_seen_voucher_mint_tx(
  fixture: FirstSeenVoucherFixture,
) -> fuzz_dsl.ProtocolTxFixture {
  run_first_seen_voucher_mint_transition(fixture)
    |> fuzz_dsl.with_protocol_validator_check(
        "trace_registry",
        trace_registry_validator.spend_trace_registry.spend(
          fixture.mock_data.directory_auth_token.policy_id,
          fixture.mock_data.directory_auth_token,
          fixture.mock_data.bridge_registry_token,
          "",
          Some(fixture.trace_registry_datum),
          fixture.trace_registry_redeemer,
          fixture.trace_registry_spent_output_ref,
          fixture.transaction,
        ),
      )
}

fn first_seen_metadata_datum_with(
  name: ByteArray,
  ticker: ByteArray,
  description: ByteArray,
  full_denom: ByteArray,
  voucher_policy_id: PolicyId,
) -> Data {
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  custom_metadata_datum(
    name,
    ticker,
    description,
    full_denom,
    voucher_policy_id,
    token_name,
  )
}

test prop_voucher_first_mint_policy_accepts_valid_metadata(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.voucher.first_mint.valid_metadata")

  // First-seen voucher mint must create the canonical CIP-68 metadata output
  // for the full denom trace and voucher policy.
  first_seen_voucher_fixture(
    canonical_first_seen_metadata_output(),
    fuzz_dsl.no_mutation(),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_valid
}

test prop_tx_first_seen_voucher_mint_couples_registry_append(
  _seed via fuzz.int(),
) {
  fuzz.label(@"regression.tx.voucher.first_mint.valid_registry_coupled")
  fuzz.label(@"regression.tx.packet.recv.valid_sink_mints_voucher")

  // tx.* depth: voucher mint and trace-registry append are checked together so
  // metadata cannot be minted without the matching denom trace entry.
  first_seen_voucher_fixture(
    canonical_first_seen_metadata_output(),
    fuzz_dsl.no_mutation(),
  )
    |> run_first_seen_voucher_mint_tx
    |> fuzz_dsl.assert_protocol_valid
}

test prop_voucher_mint_existing_trace_requires_policy_scoped_metadata(
  _seed via fuzz.int(),
) {
  fuzz.label(
    @"regression.contract.voucher.existing_trace.valid_new_policy_metadata",
  )

  let mock_data = prepare_mock_data()
  let active_v2_voucher_policy_id = "mint voucher policy id v2"
  let active_v2_registry_input =
    make_bridge_registry_input(
      mock_data.bridge_registry_token,
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      active_v2_voucher_policy_id,
      [mock_data.voucher_minting_policy_id],
    )
  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"
  let transfer_amount = 100
  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"
  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }
  let prefixed_denom =
    bytearray.concat(
      transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel),
      ftpd.denom,
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      prefixed_denom,
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let channel_redeemer_in_data: Redeemer = channel_redeemer
  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)
  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(
        active_v2_voucher_policy_id,
        token_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let metadata_output =
    make_metadata_output(
      mock_data.voucher_metadata_script_hash,
      prefixed_denom,
      active_v2_voucher_policy_id,
      token_name,
      reference_token_name,
    )
  let mint =
    from_asset(active_v2_voucher_policy_id, token_name, transfer_amount)
      |> assets.add(active_v2_voucher_policy_id, reference_token_name, 1)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input, shard_reference_input, active_v2_registry_input,
      ],
      outputs: [voucher_output, metadata_output],
      redeemers: [
        Pair(Mint(active_v2_voucher_policy_id), mint_voucher_redeemer_in_data),
        Pair(Spend(channel_input.output_reference), channel_redeemer_in_data),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    active_v2_voucher_policy_id,
    transaction,
  )
}

test prop_voucher_mint_existing_trace_rejects_missing_policy_metadata(
  _seed via fuzz.int(),
) fail {
  fuzz.label(
    @"regression.contract.voucher.existing_trace.invalid_missing_policy_metadata",
  )

  let mock_data = prepare_mock_data()
  let active_v2_voucher_policy_id = "mint voucher policy id v2"
  let active_v2_registry_input =
    make_bridge_registry_input(
      mock_data.bridge_registry_token,
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      active_v2_voucher_policy_id,
      [mock_data.voucher_minting_policy_id],
    )
  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"
  let transfer_amount = 100
  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"
  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }
  let prefixed_denom =
    bytearray.concat(
      transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel),
      ftpd.denom,
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      prefixed_denom,
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let channel_redeemer_in_data: Redeemer = channel_redeemer
  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)
  let mint =
    from_asset(active_v2_voucher_policy_id, token_name, transfer_amount)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input, shard_reference_input, active_v2_registry_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(receiver_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(Mint(active_v2_voucher_policy_id), mint_voucher_redeemer_in_data),
        Pair(Spend(channel_input.output_reference), channel_redeemer_in_data),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    active_v2_voucher_policy_id,
    transaction,
  )
}

test prop_tx_first_seen_voucher_mint_rejects_wrong_metadata_registry_coupled(
  _seed via fuzz.int(),
) {
  fuzz.label(
    @"regression.tx.voucher.first_mint.invalid_wrong_metadata_registry_coupled",
  )

  // The trace-registry append still matches the minted denom, but the CIP-68
  // metadata output tells a different human-readable story. The composed tx
  // must fail through the voucher policy while the registry check remains
  // tied to the same transaction.
  let full_denom = "port-99/channel-99/ibc/usdt"
  let metadata_datum =
    first_seen_metadata_datum_with(
      "usdt",
      "usdt",
      "not the real denom trace",
      full_denom,
      "mint voucher policy id",
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_metadata_registry_coupled"),
  )
    |> run_first_seen_voucher_mint_tx
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_voucher_first_mint_policy_rejects_wrong_name(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.voucher.first_mint.invalid_wrong_name")

  // Human-readable name must be derived from the same full denom as the token.
  let full_denom = "port-99/channel-99/ibc/usdt"
  let metadata_datum =
    first_seen_metadata_datum_with(
      "fake-usdt",
      "usdt",
      metadata_description(full_denom),
      full_denom,
      "mint voucher policy id",
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_name"),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_voucher_first_mint_policy_rejects_wrong_ticker(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.voucher.first_mint.invalid_wrong_ticker")

  // Ticker is also canonical; otherwise wallets could display a misleading
  // asset symbol for a correctly named voucher.
  let full_denom = "port-99/channel-99/ibc/usdt"
  let metadata_datum =
    first_seen_metadata_datum_with(
      "usdt",
      "FAKE",
      metadata_description(full_denom),
      full_denom,
      "mint voucher policy id",
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_ticker"),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_voucher_first_mint_policy_rejects_wrong_description(
  _seed via fuzz.int(),
) {
  fuzz.label(
    @"regression.contract.voucher.first_mint.invalid_wrong_description",
  )

  // Description carries the denom trace. It must not tell a different route
  // story than the actual voucher asset name.
  let full_denom = "port-99/channel-99/ibc/usdt"
  let metadata_datum =
    first_seen_metadata_datum_with(
      "usdt",
      "usdt",
      "not the real denom trace",
      full_denom,
      "mint voucher policy id",
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_description"),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_voucher_first_mint_policy_rejects_wrong_full_denom(
  _seed via fuzz.int(),
) {
  fuzz.label(@"regression.contract.voucher.first_mint.invalid_wrong_full_denom")

  // The metadata is internally consistent for the wrong denom, but the minted
  // asset name is derived from the correct denom. That mismatch must fail.
  let wrong_full_denom = "port-99/channel-404/ibc/usdt"
  let correct_full_denom = "port-99/channel-99/ibc/usdt"
  let metadata_datum =
    first_seen_metadata_datum_with(
      "usdt",
      "usdt",
      metadata_description(wrong_full_denom),
      wrong_full_denom,
      "mint voucher policy id",
    )
  let voucher_denom_hash =
    voucher_asset_name.voucher_denom_hash(correct_full_denom)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_full_denom"),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_voucher_first_mint_policy_rejects_wrong_policy(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.voucher.first_mint.invalid_wrong_policy")

  // Metadata must name the policy that actually controls the voucher supply.
  let full_denom = "port-99/channel-99/ibc/usdt"
  let metadata_datum =
    first_seen_metadata_datum_with(
      "usdt",
      "usdt",
      metadata_description(full_denom),
      full_denom,
      "wrong voucher policy id",
    )
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_policy"),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_voucher_first_mint_policy_rejects_wrong_reference_asset(
  _seed via fuzz.int(),
) {
  fuzz.label(
    @"regression.contract.voucher.first_mint.invalid_wrong_reference_asset",
  )

  // The CIP-68 reference NFT name is derived from the same denom hash as the
  // user token. A wrong reference asset would let metadata attach to another
  // denom.
  let full_denom = "port-99/channel-99/ibc/usdt"
  let wrong_full_denom = "port-99/channel-404/ibc/usdt"
  let metadata_datum =
    voucher_metadata.build_datum(
      full_denom,
      voucher_asset_name.voucher_user_token_name(full_denom),
      "mint voucher policy id",
    )
  let wrong_reference_token_name =
    voucher_asset_name.voucher_reference_token_name(wrong_full_denom)

  first_seen_voucher_fixture(
    mutated_first_seen_metadata_output(
      metadata_datum,
      "mint voucher policy id",
      wrong_reference_token_name,
    ),
    fuzz_dsl.mutation("wrong_reference_asset"),
  )
    |> run_first_seen_voucher_mint_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test test_mint_voucher() {
  let mock_data = prepare_mock_data()

  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"

  let transfer_amount = 100

  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }

  let packet_data = TransferModuleData(ftpd)

  let spend_module_redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: packet_data,
      },
    )

  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let active_shard_input =
    make_shard_spend_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer
  let trace_registry_redeemer_in_data: Redeemer =
    InsertTrace { voucher_hash: voucher_denom_hash, full_denom: prefixed_denom }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
      Pair(
        Spend(channel_input.output_reference),
        spend_channel_redeemer_in_data,
      ),
      Pair(
        Spend(active_shard_input.output_reference),
        trace_registry_redeemer_in_data,
      ),
    ]

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
      |> assets.add(
          mock_data.voucher_minting_policy_id,
          reference_token_name,
          1,
        )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let metadata_output =
    make_metadata_output(
      mock_data.voucher_metadata_script_hash,
      prefixed_denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
    )

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input, active_shard_input],
      reference_inputs: [directory_input, mock_data.bridge_registry_input],
      outputs: [voucher_output, metadata_output],
      redeemers,
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_mint_voucher_fails_with_wrong_mint_quantity() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"
  let transfer_amount = 100
  let wrong_amount = transfer_amount - 1
  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }
  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }
  let spend_module_redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: TransferModuleData(ftpd),
      },
    )
  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let active_shard_input =
    make_shard_spend_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer
  let trace_registry_redeemer_in_data: Redeemer =
    InsertTrace { voucher_hash: voucher_denom_hash, full_denom: prefixed_denom }

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, wrong_amount)
      |> assets.add(
          mock_data.voucher_minting_policy_id,
          reference_token_name,
          1,
        )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)
  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        wrong_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let metadata_output =
    make_metadata_output(
      mock_data.voucher_metadata_script_hash,
      prefixed_denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
    )
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input, active_shard_input],
      reference_inputs: [directory_input, mock_data.bridge_registry_input],
      outputs: [voucher_output, metadata_output],
      redeemers: [
        Pair(purpose, mint_voucher_redeemer_in_data),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
        Pair(
          Spend(active_shard_input.output_reference),
          trace_registry_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_mint_voucher_fails_with_noncanonical_metadata_datum() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"

  let transfer_amount = 100

  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }

  let packet_data = TransferModuleData(ftpd)

  let spend_module_redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: packet_data,
      },
    )

  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let active_shard_input =
    make_shard_spend_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer
  let trace_registry_redeemer_in_data: Redeemer =
    InsertTrace { voucher_hash: voucher_denom_hash, full_denom: prefixed_denom }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
      Pair(
        Spend(channel_input.output_reference),
        spend_channel_redeemer_in_data,
      ),
      Pair(
        Spend(active_shard_input.output_reference),
        trace_registry_redeemer_in_data,
      ),
    ]

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
      |> assets.add(
          mock_data.voucher_minting_policy_id,
          reference_token_name,
          1,
        )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }
  let metadata_output =
    make_metadata_output(
      mock_data.voucher_metadata_script_hash,
      "transfer/channel-404/ibc/usdt",
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
    )

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input, active_shard_input],
      reference_inputs: [directory_input, mock_data.bridge_registry_input],
      outputs: [voucher_output, metadata_output],
      redeemers,
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_mint_voucher_fails_without_trace_registry_witness() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"

  let transfer_amount = 100
  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
      data: ftpd,
    }

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let token_name = voucher_asset_name.voucher_user_token_name(prefixed_denom)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_dest_channel,
    )
  let channel_redeemer =
    RecvPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        packet_dest_port,
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_commitment: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer
  let spend_module_redeemer_in_data: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: TransferModuleData(ftpd),
      },
    )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [mock_data.bridge_registry_input],
      outputs: [
        Output {
          address: from_verification_key(receiver_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_burn_voucher() {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"

  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let packet_data =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cardano sender verification key",
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let mint_voucher_redeemer =
    BurnVoucher { packet_source_port, packet_source_channel, data: packet_data }

  let spend_module_redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: packet_source_channel, data: packet_data },
      ),
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    SendPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(packet_data),
      ),
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let token_name = voucher_asset_name.voucher_user_token_name(packet_data.denom)

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [mock_data.bridge_registry_input],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        -transfer_amount,
      ),
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_burn_legacy_voucher_uses_active_deployment_from_registry() {
  let mock_data = prepare_mock_data()
  let active_v2_voucher_policy_id = "new active voucher policy id"
  let legacy_registry_input =
    make_bridge_registry_input(
      mock_data.bridge_registry_token,
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      active_v2_voucher_policy_id,
      [mock_data.voucher_minting_policy_id],
    )

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let packet_data =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cardano sender verification key",
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let mint_voucher_redeemer =
    BurnVoucher { packet_source_port, packet_source_channel, data: packet_data }
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    SendPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(packet_data),
      ),
    }
  let token_name = voucher_asset_name.voucher_user_token_name(packet_data.denom)
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [legacy_registry_input],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        -transfer_amount,
      ),
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_burn_voucher_fails_with_wrong_burn_quantity() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let packet_data =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cardano sender verification key",
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let mint_voucher_redeemer =
    BurnVoucher { packet_source_port, packet_source_channel, data: packet_data }
  let spend_module_redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: packet_source_channel, data: packet_data },
      ),
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    SendPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(packet_data),
      ),
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer
  let token_name = voucher_asset_name.voucher_user_token_name(packet_data.denom)

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [mock_data.bridge_registry_input],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint: from_asset(
        mock_data.voucher_minting_policy_id,
        token_name,
        0 - transfer_amount + 1,
      ),
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher() {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
    )
  let metadata_reference_input =
    make_metadata_reference_input(
      mock_data.voucher_metadata_script_hash,
      ftpd.denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
      3,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer =
    RefundVoucher {
      packet_source_port,
      packet_source_channel,
      data: ftpd,
      acknowledgement: None,
    }
  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: packet_source_channel,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    TimeoutPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_unreceived: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
      next_sequence_recv: 1,
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input,
        shard_reference_input,
        metadata_reference_input,
        mock_data.bridge_registry_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher_fails_with_wrong_policy_memo() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker("next voucher minting policy id"),
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
    )
  let metadata_reference_input =
    make_metadata_reference_input(
      mock_data.voucher_metadata_script_hash,
      ftpd.denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
      3,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer =
    RefundVoucher {
      packet_source_port,
      packet_source_channel,
      data: ftpd,
      acknowledgement: None,
    }
  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: packet_source_channel,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    TimeoutPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_unreceived: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
      next_sequence_recv: 1,
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input,
        shard_reference_input,
        metadata_reference_input,
        mock_data.bridge_registry_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher_fails_with_wrong_mint_quantity() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
    )
  let metadata_reference_input =
    make_metadata_reference_input(
      mock_data.voucher_metadata_script_hash,
      ftpd.denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
      3,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let wrong_mint =
    from_asset(
      mock_data.voucher_minting_policy_id,
      token_name,
      transfer_amount - 1,
    )
  let mint_voucher_redeemer =
    RefundVoucher {
      packet_source_port,
      packet_source_channel,
      data: ftpd,
      acknowledgement: None,
    }
  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: packet_source_channel,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    TimeoutPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_unreceived: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
      next_sequence_recv: 1,
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input,
        shard_reference_input,
        metadata_reference_input,
        mock_data.bridge_registry_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: wrong_mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint: wrong_mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher_fails_when_hash_is_duplicated_in_archived_shard() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let archived_shard_name = "archived-shard-0f"
  let directory_input =
    make_directory_input_with_archived(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
      [archived_shard_name],
    )
  let active_shard_reference_input =
    make_shard_reference_input_with_output_index(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
      1,
    )
  let archived_duplicate_reference_input =
    make_shard_reference_input_with_output_index(
      mock_data.directory_auth_token.policy_id,
      archived_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
      2,
    )
  let metadata_reference_input =
    make_metadata_reference_input(
      mock_data.voucher_metadata_script_hash,
      ftpd.denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
      3,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer =
    RefundVoucher {
      packet_source_port,
      packet_source_channel,
      data: ftpd,
      acknowledgement: None,
    }
  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: packet_source_channel,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    TimeoutPacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        "channel-1",
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      proof_unreceived: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
      next_sequence_recv: 1,
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input,
        active_shard_reference_input,
        archived_duplicate_reference_input,
        metadata_reference_input,
        mock_data.bridge_registry_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

// ID-503-Not possible to refund voucher if transfer succeeds
test test_refund_voucher_fail() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let packet_dest_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: voucher_policy_memo.marker(mock_data.voucher_minting_policy_id),
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_denom_hash,
    )
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
    )
  let metadata_reference_input =
    make_metadata_reference_input(
      mock_data.voucher_metadata_script_hash,
      ftpd.denom,
      mock_data.voucher_minting_policy_id,
      token_name,
      reference_token_name,
      3,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let success_ack = acknowledgement.new_result_acknowledgement(#[1])
  let mint_voucher_redeemer =
    RefundVoucher {
      packet_source_port,
      packet_source_channel,
      data: ftpd,
      acknowledgement: Some(success_ack),
    }
  let spend_module_redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: packet_dest_channel,
        acknowledgement: success_ack,
        data: TransferModuleData(ftpd),
      },
    )
  let channel_input =
    make_channel_input(
      mock_data.channel_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      packet_source_channel,
    )
  let channel_redeemer =
    AcknowledgePacket {
      packet: make_packet(
        packet_source_port,
        packet_source_channel,
        "transfer",
        packet_dest_channel,
        fungible_token_packet_data.get_bytes(ftpd),
      ),
      acknowledgement: acknowledgement.marshal_json(success_ack),
      proof_acked: mock_proof(),
      proof_height: Height { revision_number: 1, revision_height: 1 },
    }
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let spend_channel_redeemer_in_data: Redeemer = channel_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, channel_input],
      reference_inputs: [
        directory_input,
        shard_reference_input,
        metadata_reference_input,
        mock_data.bridge_registry_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
        Pair(
          Spend(channel_input.output_reference),
          spend_channel_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mock_data.bridge_registry_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}
