use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/params
use ibc/utils/math

pub fn get_block_delay(connection: ConnectionEnd) -> Int {
  math.ceil_divide_uinteger(
    connection.delay_period,
    params.max_expected_time_per_block,
  )
}
