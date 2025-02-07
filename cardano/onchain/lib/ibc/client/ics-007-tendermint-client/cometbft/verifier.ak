use aiken/collection/list
use aiken/math/rational.{Rational}
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validation
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/utils/time.{Duration, Time}
use ibc/utils/tx_time.{TxTime} as tx_time_mod

pub fn verify(
  trusted_header: SignedHeader,
  trusted_vals: ValidatorSet,
  untrusted_header: SignedHeader,
  untrusted_vals: ValidatorSet,
  trusting_period: Duration,
  tx_time: TxTime,
  max_clock_drift: Duration,
  trust_level: Rational,
) -> Bool {
  if untrusted_header.header.height != trusted_header.header.height + 1 {
    verify_non_adjacent(
      trusted_header,
      trusted_vals,
      untrusted_header,
      untrusted_vals,
      trusting_period,
      tx_time,
      max_clock_drift,
      trust_level,
    )
  } else {
    verify_adjacent(
      trusted_header,
      untrusted_header,
      untrusted_vals,
      trusting_period,
      tx_time,
      max_clock_drift,
    )
  }
}

pub fn verify_adjacent(
  trusted_header: SignedHeader,
  untrusted_header: SignedHeader,
  untrusted_vals: ValidatorSet,
  trusting_period: Duration,
  tx_time: TxTime,
  max_clock_drift: Duration,
) -> Bool {
  and {
    untrusted_header.header.height == trusted_header.header.height + 1,
    !header_expired(trusted_header, trusting_period, tx_time.valid_to),
    verify_new_header_and_vals(
      untrusted_header,
      untrusted_vals,
      trusted_header,
      tx_time.valid_from,
      max_clock_drift,
    ),
    bytearray.compare(
      untrusted_header.header.validators_hash,
      trusted_header.header.next_validators_hash,
    ) == Equal,
    validation.verify_commit_light(
      trusted_header.header.chain_id,
      untrusted_vals,
      untrusted_header.commit.block_id,
      untrusted_header.header.height,
      untrusted_header.commit,
      None,
    ),
  }
}

pub fn verify_non_adjacent(
  trusted_header: SignedHeader,
  trusted_vals: ValidatorSet,
  untrusted_header: SignedHeader,
  untrusted_vals: ValidatorSet,
  trusting_period: Duration,
  tx_time: TxTime,
  max_clock_drift: Duration,
  trust_level: Rational,
) -> Bool {
  let list_vote_sign_bytes =
    list.indexed_map(
      untrusted_header.commit.signatures,
      fn(idx, _sig) {
        vote.vote_sign_bytes_for_commit(
          untrusted_header.commit,
          trusted_header.header.chain_id,
          idx,
        )
      },
    )

  and {
    untrusted_header.header.height != trusted_header.header.height + 1,
    !header_expired(trusted_header, trusting_period, tx_time.valid_to),
    verify_new_header_and_vals(
      untrusted_header,
      untrusted_vals,
      trusted_header,
      tx_time.valid_from,
      max_clock_drift,
    ),
    validation.verify_commit_light_trusting(
      trusted_header.header.chain_id,
      trusted_vals,
      untrusted_header.commit,
      trust_level,
      Some(list_vote_sign_bytes),
    ),
    validation.verify_commit_light(
      trusted_header.header.chain_id,
      untrusted_vals,
      untrusted_header.commit.block_id,
      untrusted_header.header.height,
      untrusted_header.commit,
      Some(list_vote_sign_bytes),
    ),
  }
}

fn header_expired(h: SignedHeader, trusting_period: Duration, now: Time) -> Bool {
  let expiration_time = h.header.time + trusting_period
  !(expiration_time > now)
}

fn verify_new_header_and_vals(
  untrusted_header: SignedHeader,
  untrusted_vals: ValidatorSet,
  trusted_header: SignedHeader,
  now: Time,
  max_clock_drift: Duration,
) -> Bool {
  and {
    untrusted_header
      |> signed_header.validate_basic(trusted_header.header.chain_id),
    untrusted_header.header.height > trusted_header.header.height,
    untrusted_header.header.time > trusted_header.header.time,
    untrusted_header.header.time < now + max_clock_drift,
    untrusted_header.header.validators_hash == validator_set.hash(
      untrusted_vals,
    ),
  }
}
