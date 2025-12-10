/**
 * Request message for submitting a signed Cardano transaction.
 * Used by Hermes relayer to submit transactions it has signed.
 */
export interface SubmitSignedTxRequest {
  /**
   * Signed transaction in CBOR hex format.
   * This is the completed, signed Cardano transaction ready for submission.
   */
  signed_tx_cbor: string;
  
  /**
   * Optional metadata for logging/debugging.
   */
  description?: string;
}

/**
 * Response message for submitting a signed Cardano transaction.
 */
export interface SubmitSignedTxResponse {
  /**
   * Transaction hash (Blake2b-256 hash of the signed transaction).
   */
  tx_hash: string;
  
  /**
   * Block height at which the transaction was confirmed (if available).
   */
  height?: string;
  
  /**
   * Raw transaction events (optional, for IBC event parsing).
   */
  events?: Array<{
    type: string;
    attributes: Array<{
      key: string;
      value: string;
    }>;
  }>;
}

