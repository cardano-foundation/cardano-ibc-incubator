import axios from "axios";

export interface Root {
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
): Promise<Channel | undefined> {
  const url = `${endpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`;
  // const url = 'http://34.250.140.20:1317/ibc/core/channel/v1/channels/channel-4/ports/transfer';

  try {
    const response = await axios.get(url);
    const channelJson = JSON.parse(response.data);
    return channelJson as Channel;
  } catch (error) {
    console.error("Error:", error);
    return undefined;
  }
}

// Example call function
async function exampleCall() {
    const endpoint = "http://34.250.140.20:1317";
    const channelId = "channel-4";
    const portId = "transfer";

    try {
        const channelData = await getChannelFromChain(endpoint, channelId, portId);
        console.log("Channel Data:", channelData?.connection_hops[0]);
    } catch (error) {
        console.error("Error:", error);
    }
}

exampleCall();