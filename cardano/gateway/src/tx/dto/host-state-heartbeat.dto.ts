export interface BuildHostStateHeartbeatRequest {
  signer: string;
}

export interface BuildHostStateHeartbeatResponse {
  heartbeat_required: boolean;
  current_epoch: number;
  host_state_epoch: number;
  next_check_delay_ms: number;
  unsigned_tx?: {
    type_url: string;
    value: Uint8Array;
  };
}
