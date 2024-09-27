import { CosmosMessage } from "@subql/types-cosmos";
import { MsgCreateClient } from "../types/proto-interfaces/ibc/core/client/v1/tx";
import { Client } from "../types";
import {ClientState as ClientOroborous} from "../util/ouroboros";
export async function handleMsgClient(
    msg: CosmosMessage<MsgCreateClient>
  ): Promise<void> {
    // logger.info(`Client type ${msg.msg.decodedMsg.clientState?.typeUrl}`);
    const anyData = msg.msg.decodedMsg.clientState?.value;
  
    // handle cosmos base client
    // const clientState = ClientTendermint.decode(anyData ?? new Uint8Array());
  
    // handle cardano client
    const clientState = ClientOroborous.decode(anyData ?? new Uint8Array());
  
    const clientId =
      msg.tx.tx.events
        .find((event) => event.type === "create_client")
        ?.attributes.find((attr) => attr.key === "client_id")
        ?.value.toString() || "";
    const consensusHeight =
      msg.tx.tx.events
        .find((event) => event.type === "create_client")
        ?.attributes.find((attr) => attr.key === "consensus_height")
        ?.value.toString() || "";
    const client = Client.create({
      id: `${msg.block.header.chainId}_${clientId}`,
      height: BigInt(msg.block.block.header.height),
      clientId: clientId,
      counterpartyChainId: clientState.chain_id,
      chainId: msg.block.header.chainId,
    });
    await client.save();
  }