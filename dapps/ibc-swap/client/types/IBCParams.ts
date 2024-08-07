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

export type RawChannelMapping = {
  srcChain: string;
  srcChannel: string;
  srcPort: string;
  destChannel: string;
  destPort: string;
  destChain?: string;
};

export type IBCDenomTrace = {
    [key: string]: DenomTrace
}