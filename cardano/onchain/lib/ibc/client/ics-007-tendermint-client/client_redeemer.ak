pub type MintClientRedeemer {
  MintClient
}

/// Redeemers accepted by the active SP1-backed Tendermint client.
///
/// Constructor 0 is deliberately retained as an empty, rejected tombstone so
/// `UpdateClientProof` keeps its existing constructor-1 wire encoding. Native
/// Tendermint messages belong to `LegacySpendClientRedeemer` and cannot decode
/// as this type.
pub type SpendClientRedeemer {
  DirectUpdateDisabled
  UpdateClientProof
}
