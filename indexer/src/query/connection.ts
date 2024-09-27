import fetch from "node-fetch";

export interface ConnectionInfo {
  connection: Connection;
  proof: string;
  proof_height: ProofHeight;
}

export interface Connection {
  client_id: string;
  versions: Version[];
  state: string;
  counterparty: Counterparty;
  delay_period: string;
}

export interface Version {
  identifier: string;
  features: string[];
}

export interface Counterparty {
  client_id: string;
  connection_id: string;
  prefix: Prefix;
}

export interface Prefix {
  key_prefix: string;
}

export interface ProofHeight {
  revision_number: string;
  revision_height: string;
}

async function getConnectionFromChain(
  endpoint: string,
  connectionId: string
): Promise<ConnectionInfo | undefined> {
  try {
    const url = `${endpoint}/ibc/core/connection/v1/connections/${connectionId}`;
   
    const response = await fetch(url);
    const jsonValue = await response.json();
    const data = jsonValue as ConnectionInfo;
    return data;
  } catch (error) {
    logger.info(`Error retrieving connection: ${error}`);
    return undefined;
  }
}

export default getConnectionFromChain;
