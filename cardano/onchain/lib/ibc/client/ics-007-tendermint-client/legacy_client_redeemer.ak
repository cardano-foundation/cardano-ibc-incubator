use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

/// Redeemer ABI for the legacy validator that verifies Tendermint messages
/// directly in Aiken. Constructor 1 is a rejected tombstone: the legacy
/// protocol is direct-only, while preserving `UpdateClient` at constructor 0.
/// New deployments use `SpendClientRedeemer` instead.
pub type LegacySpendClientRedeemer {
  UpdateClient { msg: ClientMessage }
  ProofUpdateDisabled
}
