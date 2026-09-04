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

  /**
   * Return after node acceptance. The server only honors this for a
   * structurally tree-neutral staged Tendermint session transaction.
   */
  submit_only?: boolean;

  /**
   * Optional confirmation timeout in seconds. Zero uses the ordinary server
   * default; the server enforces a bounded maximum.
   */
  confirmation_timeout_seconds?: number;

  /**
   * Structurally authenticated staged-session transaction that does not update
   * HostState. Used with submit_only=false for a confirmed phase boundary.
   */
  tree_neutral?: boolean;

  /**
   * The transaction consumes an output created by an earlier transaction in
   * the same signed chain. Only these links may receive long dependency retry.
   */
  has_prior_dependency?: boolean;
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
