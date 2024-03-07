use aiken/dict.{Dict}

pub type HandlerState {
  next_client_sequence: Int,
  next_connection_sequence: Int,
  next_channel_sequence: Int,
  bound_port: Dict<Int, Bool>,
}
