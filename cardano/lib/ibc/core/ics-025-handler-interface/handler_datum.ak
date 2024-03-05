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
  expect token == auth_token

  True
}

pub fn is_client_created_valid(old: HandlerDatum, new: HandlerDatum) -> Bool {
  expect is_auth_token_remained(old, new)

  expect new.state.next_client_sequence == old.state.next_client_sequence + 1

  True
}

fn is_auth_token_remained(old: HandlerDatum, new: HandlerDatum) -> Bool {
  old.token == new.token
}
