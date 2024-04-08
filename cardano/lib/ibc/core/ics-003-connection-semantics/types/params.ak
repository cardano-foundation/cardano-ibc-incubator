use ibc/utils/time.{Time}

/// max_expected_time_per_block (in nanoseconds), used to enforce block delay. 
/// This parameter should reflect the largest amount of time that the chain might
/// reasonably take to produce the next block under normal operating conditions. 
/// A safe choice is 3-5x the expected time per block.
pub const max_expected_time_per_block: Time = 4_000_000_000
