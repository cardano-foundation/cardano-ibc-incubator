import { BinaryReader, BinaryWriter } from "../types/proto-interfaces/binary";
import { isSet, DeepPartial, Exact } from "../types/proto-interfaces/helpers";


export interface ClientState {
  /** Chain id */
  chainId: string;

}
export interface ClientStateSDKType {
  chain_id: string;
 
}

function createBaseClientState(): ClientStateSDKType {
  return {
    chain_id: "",
    
  };
}

export const ClientState = {
  typeUrl: "/ibc.clients.cardano.v1.ClientState",
  
  decode(input: BinaryReader | Uint8Array, length?: number): ClientStateSDKType {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseClientState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.chain_id = reader.string();
          break;
        
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
 
};