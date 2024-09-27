import axios from "axios";
import fetch from "node-fetch";
export interface ClientStateInfo {
  client_state: ClientState;
  proof: any;
  proof_height: ProofHeight;
}

export interface ClientState {
  "@type": string;
  chain_id: string;
  trust_level: TrustLevel;
  trusting_period: string;
  unbonding_period: string;
  max_clock_drift: string;
  frozen_height: FrozenHeight;
  latest_height: LatestHeight;
  proof_specs: ProofSpec[];
  upgrade_path: string[];
  allow_update_after_expiry: boolean;
  allow_update_after_misbehaviour: boolean;
}

export interface TrustLevel {
  numerator: string;
  denominator: string;
}

export interface FrozenHeight {
  revision_number: string;
  revision_height: string;
}

export interface LatestHeight {
  revision_number: string;
  revision_height: string;
}

export interface ProofSpec {
  leaf_spec: LeafSpec;
  inner_spec: InnerSpec;
  max_depth: number;
  min_depth: number;
  prehash_key_before_comparison: boolean;
}

export interface LeafSpec {
  hash: string;
  prehash_key: string;
  prehash_value: string;
  length: string;
  prefix: string;
}

export interface InnerSpec {
  child_order: number[];
  child_size: number;
  min_prefix_length: number;
  max_prefix_length: number;
  empty_child: any;
  hash: string;
}

export interface ProofHeight {
  revision_number: string;
  revision_height: string;
}

async function getClientStateFromChain(
  endpoint: string,
  clientId: string
): Promise<ClientStateInfo | undefined> {
  try {
    const url = `${endpoint}/ibc/core/client/v1/client_states/${clientId}`;
   
    const response = await fetch(url);
    const jsonValue = await response.json();
    const data = jsonValue as ClientStateInfo;
    return data;
  } catch (error) {
    console.error("Error query client from chain:", error);
    return undefined;
  }
}

export default getClientStateFromChain;
