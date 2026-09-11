use aiken/collection/pairs
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Spend, Transaction,
  ValidityRange, placeholder,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClient}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyNonMembership, VerifyProofEnvelope,
}
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_003_connection_semantics/types/params
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, LeafOp, NonExistenceProof,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath, MerkleProof}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{CreateClient}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/math
use minting_client_stt
use verifying_proof

// Milliseconds, on slot boundaries. The update may be included at valid_to -
// 1000, almost two minutes after its lower bound, with a 60-second delay.
const valid_from = 1_700_000_000_000

const valid_to = valid_from + 120_000

const delay_ns = 60_000_000_000

const host_policy = #"11111111111111111111111111111111111111111111111111111111"

const client_policy =
  #"22222222222222222222222222222222222222222222222222222222"

const client_script =
  #"33333333333333333333333333333333333333333333333333333333"

const proof_policy = #"44444444444444444444444444444444444444444444444444444444"

const old_height = Height { revision_number: 0, revision_height: 1 }

const new_height = Height { revision_number: 0, revision_height: 2 }

fn leaf() -> ExistenceProof {
  ExistenceProof {
    key: "a",
    value: "commitment",
    leaf: LeafOp { ..proofs.iavl_spec().leaf_spec, prefix: #"000202" },
    path: [],
  }
}

fn store_leaf() -> ExistenceProof {
  ExistenceProof {
    key: "ibc",
    value: proof.calculate_exist(leaf()),
    leaf: proofs.tendermint_spec().leaf_spec,
    path: [],
  }
}

fn chained_proof(lower: CommitmentProof) -> MerkleProof {
  MerkleProof {
    proofs: [
      lower,
      CommitmentProof { proof: CommitmentProof_Exist { exist: store_leaf() } },
    ],
  }
}

fn initial_client() -> ClientDatum {
  let cs =
    client_state.new_client_state(
      "delay-0",
      unchecked_rational.new(1, 3),
      1_000_000_000_000,
      2_000_000_000_000,
      10_000_000_000,
      old_height,
      merkle.get_sdk_specs(),
    )
  ClientDatum {
    history_root: ibc_state_commitment.empty_hash,
    token: AuthToken {
      policy_id: client_policy,
      name: auth.generate_token_name(
        AuthToken { policy_id: host_policy, name: host_state_token_name },
        client_prefix,
        "0",
      ),
    },
    state: ClientDatumState {
      client_state: cs,
      consensus_states: [
        Pair(
          old_height,
          ConsensusState {
            timestamp: valid_from * 1_000_000,
            next_validators_hash: #"00",
            root: merkle.new_merkle_root(proof.calculate_exist(store_leaf())),
          },
        ),
      ],
      processed_times: [Pair(old_height, 0)],
      processed_heights: [Pair(old_height, 0)],
    },
  }
}

// Exercise the state transition and a real ICS-23 proof together. Full signed
// UpdateClient entry-point coverage lives in spending_client_capacity.test.ak.
fn next_header() -> Header {
  let template = header.null_header()
  Header {
    ..template,
    trusted_height: old_height,
    signed_header: SignedHeader {
      ..template.signed_header,
      header: TmHeader {
        ..template.signed_header.header,
        chain_id: "delay-0",
        height: new_height.revision_height,
        time: ( valid_from + 1000 ) * 1_000_000,
        next_validators_hash: #"00",
        app_hash: proof.calculate_exist(store_leaf()),
      },
    },
  }
}

fn updated_client(processed_time: Int) -> ClientDatum {
  let input = initial_client()
  ClientDatum {
    ..input,
    state: ClientDatumState {
      client_state: ClientState {
        ..input.state.client_state,
        latest_height: new_height,
      },
      consensus_states: [
        Pair(new_height, header.consensus_state(next_header())),
      ],
      processed_times: [Pair(new_height, processed_time)],
      processed_heights: [
        Pair(
          new_height,
          client_datum.processed_height_from_time(processed_time),
        ),
      ],
    },
  }
}

fn created_client(processed_time: Int) -> ClientDatum {
  let datum = updated_client(processed_time)
  ClientDatum {
    ..datum,
    state: ClientDatumState {
      ..datum.state,
      consensus_states: [
        Pair(new_height, header.consensus_state(next_header())),
      ],
      processed_times: [Pair(new_height, processed_time)],
      processed_heights: [
        Pair(
          new_height,
          client_datum.processed_height_from_time(processed_time),
        ),
      ],
    },
  }
}

fn mint_client(datum: ClientDatum, validity_range: ValidityRange) -> Bool {
  let host_datum =
    HostStateDatum {
      nft_policy: host_policy,
      deployer: host_policy,
      control: HostStateControl { port_registry: [], shutdown: Active },
      state: HostState {
        version: 0,
        ibc_state_root: #"00",
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        last_update_time: 0,
      },
    }
  let host_ref = OutputReference { transaction_id: #"00", output_index: 0 }
  let host_redeemer: Redeemer =
    CreateClient { client_state_siblings: [], consensus_state_siblings: [] }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output_reference: host_ref,
          output: Output {
            address: from_script(host_policy),
            value: from_asset(host_policy, host_state_token_name, 1),
            datum: InlineDatum(host_datum),
            reference_script: None,
          },
        },
      ],
      outputs: [
        Output {
          address: from_script(client_script),
          value: from_asset(client_policy, datum.token.name, 1),
          datum: InlineDatum(datum),
          reference_script: None,
        },
      ],
      mint: from_asset(client_policy, datum.token.name, 1),
      redeemers: [Pair(Spend(host_ref), host_redeemer)],
      validity_range,
    }
  minting_client_stt.mint_client_stt.mint(
    client_script,
    host_policy,
    MintClient,
    client_policy,
    tx,
  )
}

fn process_client(create: Bool) -> ClientDatum {
  let datum =
    if create {
      created_client(valid_to * 1_000_000)
    } else {
      updated_client(valid_to * 1_000_000)
    }
  expect
    if create {
      mint_client(datum, interval.between(0, valid_to))
    } else {
      client_datum.update_state(
        initial_client(),
        datum,
        next_header(),
        valid_to,
      )
    }

  datum
}

fn verify_after(
  datum: ClientDatum,
  now: Int,
  delay: Int,
  membership: Bool,
) -> Bool {
  verify_with_delays(
    datum,
    now,
    delay,
    math.ceil_divide_uinteger(delay, params.max_expected_time_per_block),
    membership,
  )
}

fn verify_with_delays(
  datum: ClientDatum,
  now: Int,
  delay: Int,
  block_delay: Int,
  membership: Bool,
) -> Bool {
  expect Some(cons_state) =
    pairs.get_first(datum.state.consensus_states, new_height)
  expect Some(processed_time) =
    pairs.get_first(datum.state.processed_times, new_height)
  expect Some(processed_height) =
    pairs.get_first(datum.state.processed_heights, new_height)
  let redeemer =
    if membership {
      VerifyMembership {
        cs: datum.state.client_state,
        cons_state,
        height: new_height,
        processed_time,
        processed_height,
        delay_time_period: delay,
        delay_block_period: block_delay,
        proof: chained_proof(
          CommitmentProof { proof: CommitmentProof_Exist { exist: leaf() } },
        ),
        path: MerklePath { key_path: ["ibc", "a"] },
        value: "commitment",
      }
    } else {
      VerifyNonMembership {
        cs: datum.state.client_state,
        cons_state,
        height: new_height,
        processed_time,
        processed_height,
        delay_time_period: delay,
        delay_block_period: block_delay,
        proof: chained_proof(
          CommitmentProof {
            proof: CommitmentProof_Nonexist {
              non_exist: NonExistenceProof {
                key: "z",
                left: leaf(),
                right: proofs.null_existance_proof(),
              },
            },
          },
        ),
        path: MerklePath { key_path: ["ibc", "z"] },
      }
    }
  verifying_proof.verify_proof.mint(
    VerifyProofEnvelope { proof: redeemer, history_witness: None },
    proof_policy,
    Transaction {
      ..placeholder,
      mint: from_asset(proof_policy, "", 1),
      validity_range: interval.between(now, now + 1000),
    },
  )
}

test create_client_rejects_backdated_processed_metadata() {
  !mint_client(created_client(0), interval.between(0, valid_to))
}

test update_client_rejects_backdated_processed_metadata() {
  !client_datum.update_state(
    initial_client(),
    updated_client(valid_from * 1_000_000),
    next_header(),
    valid_to,
  )
}

test create_client_requires_finite_upper_bound() fail {
  mint_client(created_client(valid_to * 1_000_000), interval.after(valid_from))
}

test create_client_blocks_immediate_membership() fail {
  verify_after(process_client(True), valid_to - 1000, delay_ns, True)
}

test update_client_blocks_immediate_membership() fail {
  verify_after(process_client(False), valid_to - 1000, delay_ns, True)
}

test create_client_blocks_immediate_nonmembership() fail {
  verify_after(process_client(True), valid_to - 1000, delay_ns, False)
}

test update_client_blocks_immediate_nonmembership() fail {
  verify_after(process_client(False), valid_to - 1000, delay_ns, False)
}

test create_client_blocks_membership_until_delay_boundary() fail {
  verify_after(process_client(True), valid_to + 59_999, delay_ns, True)
}

test update_client_blocks_nonmembership_until_delay_boundary() fail {
  verify_after(process_client(False), valid_to + 59_999, delay_ns, False)
}

test create_client_allows_proofs_at_delay_boundary() {
  let datum = process_client(True)
  and {
    verify_after(datum, valid_to + 60_000, delay_ns, True),
    verify_after(datum, valid_to + 60_000, delay_ns, False),
  }
}

test update_client_allows_proofs_at_delay_boundary() {
  let datum = process_client(False)
  and {
    verify_after(datum, valid_to + 60_000, delay_ns, True),
    verify_after(datum, valid_to + 60_000, delay_ns, False),
  }
}

test create_client_preserves_zero_delay() {
  let datum = process_client(True)
  and {
    verify_after(datum, valid_to - 1000, 0, True),
    verify_after(datum, valid_to - 1000, 0, False),
  }
}

test update_client_preserves_zero_delay() {
  let datum = process_client(False)
  and {
    verify_after(datum, valid_to - 1000, 0, True),
    verify_after(datum, valid_to - 1000, 0, False),
  }
}

test update_client_requires_block_delay_even_after_time_delay() fail {
  verify_after(process_client(False), valid_to + 1, 1_000_000, True)
}

test update_client_allows_proof_when_rounded_block_delay_passes() {
  verify_after(process_client(False), valid_to + 4000, 1_000_000, True)
}

test client_rejects_negative_time_delay() fail {
  verify_with_delays(process_client(False), valid_to + 60_000, -1, 0, True)
}

test client_rejects_negative_block_delay() fail {
  verify_with_delays(process_client(False), valid_to + 60_000, 0, -1, False)
}
