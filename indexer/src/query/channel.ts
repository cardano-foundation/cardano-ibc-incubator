

import fetch from "node-fetch";

export interface ChannelInfo {
  channel: Channel;
  proof: string;
  proof_height: ProofHeight;
}

export interface Channel {
  state: string;
  ordering: string;
  counterparty: Counterparty;
  connection_hops: string[];
  version: string;
}

export interface Counterparty {
  port_id: string;
  channel_id: string;
}

export interface ProofHeight {
  revision_number: string;
  revision_height: string;
}

async function getChannelFromChain(
  endpoint: string,
  channelId: string,
  portId: string
): Promise<ChannelInfo | undefined> {
  const url = `${endpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`;
  // logger.info(`getChannelFromChain: url: ${url}`);
  try {
   
    const response = await fetch(url);
    // logger.info(`getChannelFromChain: response: ${response}`);
    const jsonValue = await response.json();
    const data = jsonValue as ChannelInfo;
    return data;
  } catch (error) {
    // logger.info(`getChannelFromChain: error: ${error}`);
    return undefined;
  }
}

export default getChannelFromChain;
