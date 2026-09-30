use aiken/collection/pairs
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client.{Status}

/// In-memory interface between a registered light client and IBC core.
/// Client and consensus payloads retain their original encoding. Only the
/// client's adapter may interpret them; core binds proofs to these exact values.
/// This view is never stored as the client datum or committed to the IBC tree.
pub type ClientStateView {
  client_state: Data,
  consensus_states: Pairs<Height, Data>,
  processed_times: Pairs<Height, Int>,
  processed_heights: Pairs<Height, Int>,
}

pub type ClientView {
  state: ClientStateView,
  token: AuthToken,
  latest_height: Height,
  status: Status,
  timestamps: Pairs<Height, Int>,
}

pub fn timestamp_at_height(client: ClientView, height: Height) -> Option<Int> {
  pairs.get_first(client.timestamps, height)
}
