import type { DenomTrace } from 'cosmjs-types/ibc/applications/transfer/v1/transfer';

type ChannelToChannel = {
  channel: string;
  port: string;
  counterChannel: string;
  counterPort: string;
};

type ChainChannels = {
  [key: string]: ChannelToChannel[];
};

export type ChainToChainChannels = {
  [key: string]: ChainChannels;
};

export type QueryChannelResponse = {
  channel_id: string;
  port_id: string;
  ordering: string;
  state: string;
  version: string;
  counterparty: {
    channel_id: string;
    port_id: string;
  };
};

export type QueryClientStateResponse = {
  client_id: string;
  client_state: {
    '@type': string;
    chain_id: string;
    latest_height: {
      revision_number: string;
      revision_height: string;
    };
    frozen_height: {
      revision_number: string;
      revision_height: string;
    };
  };
};

export type RawChannelMapping = {
  srcChain: string;
  srcChannel: string;
  srcPort: string;
  destChannel: string;
  destPort: string;
  destChain?: string;
};

export type IBCDenomTrace = {
  [key: string]: DenomTrace;
};

export type TransferRoutes = {
  foundRoute: boolean;
  chains: string[];
  routes: string[];
};
