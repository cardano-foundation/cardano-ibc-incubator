/* eslint-disable */

import { BinaryReader, BinaryWriter } from "../types/proto-interfaces/binary";
export const protobufPackage = "ibc.lightclients.tendermint.v1";
/**
 * ClientState from Tendermint tracks the current validator set, latest height,
 * and a possible frozen height.
 */


export interface ClientState {
  chain_id: string;
  
}

function createBaseClientState(): ClientState {
  return {
    chain_id: "",
   
  };
}
export const ClientState = {
  typeUrl: "/ibc.lightclients.tendermint.v1.ClientState",
  
  decode(input: BinaryReader | Uint8Array, length?: number): ClientState {
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
