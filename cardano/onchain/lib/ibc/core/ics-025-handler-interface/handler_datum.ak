use aiken/collection/list
use aiken/primitive/int
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}

pub const handler_token_name = "handler"

pub type HandlerDatum {
  state: HandlerState,
  token: AuthToken,
}

pub fn is_initialized_valid(datum: HandlerDatum, auth_token: AuthToken) -> Bool {
  let HandlerDatum { state, token } = datum

  and {
    state.next_client_sequence == 0,
    state.next_connection_sequence == 0,
    state.next_channel_sequence == 0,
    state.bound_port == [],
    token == auth_token,
  }
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
    if list.has(old.state.bound_port, port) {
      False
    } else {
      True
    }

  HandlerDatum {
    ..old,
    state: HandlerState {
      ..old.state,
      bound_port: list.push(old.state.bound_port, port)
        |> list.sort(int.compare),
    },
  } == new
}
