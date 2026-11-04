use aiken/fuzz
use aiken/interval
use ibc/core/ics_025_handler_interface/heartbeat.{HeartbeatSchedule, permitted}

test midpoint_uses_the_deployment_origin_and_accepts_missed_epochs() {
  let schedule =
    HeartbeatSchedule {
      epoch_origin_ms: 1_700_000_000_000,
      epoch_length_ms: 86_400_000,
    }
  let midpoint = schedule.epoch_origin_ms + 7 * 86_400_000 + 43_200_000
  and {
    !permitted(schedule, 0, interval.between(midpoint - 1, midpoint + 1)),
    permitted(schedule, 0, interval.between(midpoint, midpoint + 1)),
    permitted(schedule, 0, interval.between(midpoint + 1_000, midpoint + 2_000)),
    !permitted(
      schedule,
      midpoint + 1,
      interval.between(midpoint + 2, midpoint + 3),
    ),
    permitted(
      schedule,
      midpoint + 1,
      interval.between(midpoint + 86_400_000, midpoint + 86_400_001),
    ),
  }
}

fn cases() -> Fuzzer<(Int, Int, Int)> {
  let origin <- fuzz.and_then(fuzz.int_between(0, 1_000_000_000))
  let length <- fuzz.and_then(fuzz.int_between(4, 1_000_000))
  let epoch <- fuzz.map(fuzz.int_between(1, 10_000))
  (origin, length, epoch)
}

test prop_midpoint_and_epoch_limits_hold_for_custom_networks(sample via cases()) {
  fuzz.label(@"fuzz.unit.host.heartbeat.midpoint_and_epoch_limits")
  let (origin, length, epoch) = sample
  let schedule =
    HeartbeatSchedule { epoch_origin_ms: origin, epoch_length_ms: length }
  let midpoint = origin + epoch * length + length / 2
  let previous = midpoint - length + 1
  and {
    !permitted(schedule, previous, interval.between(midpoint - 1, midpoint)),
    permitted(schedule, previous, interval.between(midpoint, midpoint + 1)),
    !permitted(schedule, midpoint + 1, interval.between(midpoint, midpoint + 1)),
    !permitted(
      schedule,
      previous,
      interval.between(
        origin + ( epoch + 1 ) * length - 1,
        origin + ( epoch + 1 ) * length,
      ),
    ),
  }
}
