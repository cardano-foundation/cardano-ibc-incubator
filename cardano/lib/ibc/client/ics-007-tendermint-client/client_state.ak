use aiken/bytearray
use aiken/dict.{Dict}
use aiken/math/rational
use aiken/option
use ibc/client/ics_007_tendermint_client/cometbft/constants.{max_chain_id_len}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_002_client_semantics/types/client.{
  Active, Expired, Frozen, Status,
}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{ProofSpec}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath, MerkleProof}
use ibc/utils/string
use ibc/utils/time.{Duration, Time}

pub type ClientState {
  chain_id: ByteArray,
  trust_level: UncheckedRational,
  trusting_period: Duration,
  unbonding_period: Duration,
  max_clock_drift: Duration,
  frozen_height: Height,
  latest_height: Height,
  proof_specs: List<ProofSpec>,
}

/// NewClientState creates a new ClientState instance
pub fn new_client_state(
  chain_id: ByteArray,
  trust_level: UncheckedRational,
  trusting_period: Duration,
  unbonding_period: Duration,
  max_clock_drift: Duration,
  latest_height: Height,
  proof_specs: List<ProofSpec>,
) -> ClientState {
  ClientState {
    chain_id,
    trust_level,
    trusting_period,
    unbonding_period,
    max_clock_drift,
    frozen_height: height.zero_height(),
    latest_height,
    proof_specs,
  }
}

/// GetChainID returns the chain-id
pub fn get_chain_id(cs: ClientState) -> ByteArray {
  cs.chain_id
}

/// Validate performs a basic validation of the client state fields.
pub fn validate(cs: ClientState) -> Bool {
  // chain id cannot be empty string.
  expect string.trim_space(cs.chain_id) != ""
  // chain id not too long
  expect bytearray.length(cs.chain_id) <= max_chain_id_len
  // trustLevel must be within [1/3, 1]
  expect Some(min_trusted_level) = rational.new(1, 3)
  expect Some(max_trusted_level) = rational.new(1, 1)
  expect Some(cs_trust_level) = unchecked_rational.to_rational(cs.trust_level)
  expect
    rational.compare_with(cs_trust_level, >=, min_trusted_level) && rational.compare_with(
      cs_trust_level,
      <=,
      max_trusted_level,
    )
  // trusting period must be greater than zero
  expect cs.trusting_period > 0
  // unbonding period must be greater than zero
  expect cs.unbonding_period > 0
  // max clock drift must be greater than zero
  expect cs.max_clock_drift > 0
  // tendermint client's latest height revision height cannot be zero
  expect cs.latest_height.revision_height > 0
  // trusting period should be < unbonding period
  expect cs.trusting_period < cs.unbonding_period
  // TODO: 
  // validate latest height revision number must match chain id revision number 
  // validate proof specs
  True
}

/// get_latest_height returns latest block height.
pub fn get_latest_height(cs: ClientState) -> Height {
  cs.latest_height
}

/// get_timestamp_at_height returns the timestamp in nanoseconds of the consensus state at the given height.
/// In ibc-go, it is implemented by querying consensus at height from the clientstore, however, with cardano
/// there is no client store, and consensus at height has been pushed into the transaction from the off-chain part,
/// so we use "_" in height to ignore it. We also use "_" in client state field to mark this function
/// as a "method" of ClientState struct.
pub fn get_timestamp_at_height(
  _cs: ClientState,
  consensus_states: Dict<Height, ConsensusState>,
  height: Height,
) -> Option<Int> {
  dict.get(consensus_states, height)
    |> option.map(fn(cons_state) { cons_state.timestamp })
}

pub fn is_expired(cs: ClientState, latest_timestamp: Time, now: Time) -> Bool {
  let expiration_time = latest_timestamp + cs.trusting_period
  expiration_time <= now
}

pub fn status(
  client_state: ClientState,
  now: Time,
  consensus_states: Dict<Height, ConsensusState>,
) -> Status {
  if !height.is_zero(client_state.frozen_height) {
    Frozen
  } else {
    let latest_height = get_latest_height(client_state)
    let consensus_state = consensus_states |> dict.get(latest_height)
    when consensus_state is {
      None -> Expired
      Some(cons_state) ->
        if is_expired(client_state, cons_state.timestamp, now) {
          Expired
        } else {
          Active
        }
    }
  }
}

/// Initialize checks that the initial consensus state is an 07-tendermint consensus state and
/// sets the client state, consensus state and associated metadata in the provided client store.
pub fn initialized(
  _client_state: ClientState,
  _consensus_state: ConsensusState,
) -> Bool {
  // Note: In Aiken, ClientState is initialized and stored in UTXO instead of being initialized
  // on-chain, as in ibc-go. Therefore, this function is only used for reference and mapping to
  // the ibc specs' purpose.
  True
}

pub fn verify_membership(
  cs: ClientState,
  cons_state: ConsensusState,
  height: Height,
  delay_time_period: Int,
  delay_block_period: Int,
  proof: MerkleProof,
  path: MerklePath,
  value: ByteArray,
) -> Bool {
  expect height.compare(get_latest_height(cs), height) != Less
  expect
    verify_delay_period_passed(height, delay_time_period, delay_block_period)
  merkle.verify_membership(proof, cs.proof_specs, cons_state.root, path, value)
}

pub fn verify_non_membership(
  cs: ClientState,
  cons_state: ConsensusState,
  height: Height,
  delay_time_period: Int,
  delay_block_period: Int,
  proof: MerkleProof,
  path: MerklePath,
) -> Bool {
  expect height.compare(get_latest_height(cs), height) != Less
  expect
    verify_delay_period_passed(height, delay_time_period, delay_block_period)
  merkle.verify_non_membership(proof, cs.proof_specs, cons_state.root, path)
}

fn verify_delay_period_passed(
  _proof_height: Height,
  _delay_time_period: Int,
  _delay_block_period: Int,
) -> Bool {
  True
}
