import { GatewayEvent } from '../tx-events.service';

/**
 * Hash-only notification for a transaction Hermes already submitted through
 * its trusted Cardano node connection.
 */
export interface ObserveTxRequest {
  tx_hash: string;
  allow_untracked?: boolean;
}

export interface ObserveTxResponse {
  tx_hash: string;
  height: string;
  events: GatewayEvent[];
}
