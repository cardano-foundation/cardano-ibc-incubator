use aiken/dict
use aiken/int
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}

pub const handler_token_name = "handler"

pub type HandlerDatum {
  state: HandlerState,
  token: AuthToken,
}

pub fn is_initialized_valid(datum: HandlerDatum, auth_token: AuthToken) -> Bool {
  let HandlerDatum { state, token } = datum

  expect state.next_client_sequence == 0

  expect state.next_connection_sequence == 0

  expect state.next_channel_sequence == 0

  expect state.bound_port == dict.new()

  expect token == auth_token

  True
}

pub fn validate_create_client(old: HandlerDatum, new: HandlerDatum) -> Bool {
  HandlerDatum {
    ..old,
    state: HandlerState {
      ..old.state,
      next_client_sequence: old.state.next_client_sequence + 1,
    },
  } == new
}

pub fn validate_create_connection(old: HandlerDatum, new: HandlerDatum) -> Bool {
  HandlerDatum {
    ..old,
    state: HandlerState {
      ..old.state,
      next_connection_sequence: old.state.next_connection_sequence + 1,
    },
  } == new
}

pub fn validate_create_channel(old: HandlerDatum, new: HandlerDatum) -> Bool {
  HandlerDatum {
    ..old,
    state: HandlerState {
      ..old.state,
      next_channel_sequence: old.state.next_channel_sequence + 1,
    },
  } == new
}

pub fn validate_bind_port(
  old: HandlerDatum,
  new: HandlerDatum,
  port: Int,
) -> Bool {
  expect
    when dict.get(old.state.bound_port, port) is {
      Some(val) -> val == False
      None -> True
    }

  HandlerDatum {
    ..old,
    state: HandlerState {
      ..old.state,
      bound_port: dict.insert(old.state.bound_port, port, True, int.compare),
    },
  } == new
}
