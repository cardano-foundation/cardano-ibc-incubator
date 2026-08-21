pub type TransferEscrowDatum {
  TransferEscrowDatum {
    channel_id: ByteArray,
    denom: ByteArray,
    // Logical IBC escrow principal. For lovelace this deliberately excludes
    // any additional ADA carried by the UTxO to satisfy minimum-UTxO rules.
    escrowed_amount: Int,
  }
}
