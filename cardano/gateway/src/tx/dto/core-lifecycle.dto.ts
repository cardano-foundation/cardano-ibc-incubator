export interface ClientLifecycleRequest {
  signer: string;
  client_id: string;
}

export interface ConnectionLifecycleRequest {
  signer: string;
  connection_id: string;
}

export interface ChannelLifecycleRequest {
  signer: string;
  port_id: string;
  channel_id: string;
}

export interface CoreLifecycleTxResponse {
  unsigned_tx: {
    type_url: string;
    value: Uint8Array;
  };
}
