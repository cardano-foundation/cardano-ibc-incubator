use aiken/bytearray
use aiken/pairs
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/cometbft/verifier
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/utils/tx_time.{TxTime} as tx_time_mod

pub fn verify_header(
  cs: ClientState,
  tx_time: TxTime,
  consensus_states: Pairs<Height, ConsensusState>,
  header: Header,
) {
  expect Some(cons_state) =
    pairs.get_first(consensus_states, header.trusted_height)

  expect check_trusted_header(header, cons_state)
  expect
    header_mod.get_height(header).revision_number == header.trusted_height.revision_number
  expect
    height.compare(header_mod.get_height(header), header.trusted_height) == Greater

  expect Some(cs_trust_level) = unchecked_rational.to_rational(cs.trust_level)

  // Only height, time, and next_validators_hash are necessary for verification
  let trusted_header =
    SignedHeader {
      header: tm_header.TmHeader {
        ..tm_header.null_tm_header(),
        chain_id: cs.chain_id,
        height: header.trusted_height.revision_height,
        time: cons_state.timestamp,
        next_validators_hash: cons_state.next_validators_hash,
      },
      commit: commit.null_commit(),
    }

  expect
    verifier.verify(
      trusted_header,
      header.trusted_validators,
      header.signed_header,
      header.validator_set,
      cs.trusting_period,
      tx_time,
      cs.max_clock_drift,
      cs_trust_level,
    )

  True
}

/// check_trusted_header() checks that consensus state matches trusted fields of Header
pub fn check_trusted_header(header: Header, cons_state: ConsensusState) {
  expect
    bytearray.compare(
      cons_state.next_validators_hash,
      validator_set.hash(header.trusted_validators),
    ) == Equal
  True
}
