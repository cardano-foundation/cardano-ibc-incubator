import config from "../config/config";
import getChannelFromChain from "./channel";
import getClientStateFromChain from "./client";
import getConnectionFromChain from "./connection";
import fetch from "node-fetch";

export async function getCounterChainFromChannel(
  chainId: string,
  channelId: string,
  portId: string
): Promise<string | undefined> {
  let endpoint = "";
  switch (chainId) {
    case "localosmosis":
      endpoint = config.LocalOsmosisRpc;
      break;
    case "sidechain":
      endpoint = config.SideChainRpc;
    default:
      break;
  }

  if (endpoint === "") {
    logger.info("endpoint undefined");
    return undefined;
  }

  const channel = await getChannelFromChain(endpoint, channelId, portId);
  if (channel === undefined) {
    logger.info("channel undefined");
    return undefined;
  }

  const connection = await getConnectionFromChain(
    endpoint,
    channel.channel.connection_hops[0]
  );
  if (connection === undefined) {
    logger.info("connection undefined");
    return undefined;
  }

  const client = await getClientStateFromChain(
    endpoint,
    connection.connection.client_id
  );
  if (client === undefined) {
    logger.info("client undefined");
    return undefined;
  }
  return client.client_state.chain_id;
}

export async function getPathFromDenom(
  chainId: string,
  denom: string
): Promise<string | undefined> {
  let endpoint = "";
  switch (chainId) {
    case "localosmosis":
      endpoint = config.LocalOsmosisRpc;
      break;
    case "sidechain":
      endpoint = config.SideChainRpc;
    default:
      break;
  }
  if (endpoint === "") {
    logger.info("endpoint undefined");
    return undefined;
  }
 

  try {
    const url = `${endpoint}/ibc/apps/transfer/v1/denom_traces/${denom}`;
    const response = await fetch(url);
    const jsonValue = await response.json();
    
    return `${jsonValue.denom_trace.path}/${jsonValue.denom_trace.base_denom}`

  } catch (error) {
    logger.info(`getPathFromDenom: error: ${error}`);
    return undefined;
    
  }
}
