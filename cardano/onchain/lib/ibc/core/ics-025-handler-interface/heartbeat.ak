use aiken/interval.{Finite}
use cardano/transaction.{ValidityRange}

/// Immutable network timing supplied when the HostState scripts are applied.
pub type HeartbeatSchedule {
  epoch_origin_ms: Int,
  epoch_length_ms: Int,
}

pub const max_validity_ms = 120_000

/// A missed midpoint can be retried until the end of that epoch. A validity
/// interval must stay inside one epoch so its saved upper bound identifies it.
pub fn permitted(
  schedule: HeartbeatSchedule,
  previous_upper: Int,
  validity: ValidityRange,
) -> Bool {
  expect Finite(from) = validity.lower_bound.bound_type
  expect Finite(to) = validity.upper_bound.bound_type
  let HeartbeatSchedule { epoch_origin_ms: origin, epoch_length_ms: length } =
    schedule
  expect origin >= 0 && length >= 2
  if from < origin {
    False
  } else {
    let epoch = ( from - origin ) / length
    and {
      previous_upper >= 0,
      to > from,
      to - from <= max_validity_ms,
      ( to - origin ) / length == epoch,
      from >= origin + epoch * length + length / 2,
      previous_upper == 0 || and {
        previous_upper >= origin,
        ( previous_upper - origin ) / length < epoch,
      },
    }
  }
}
