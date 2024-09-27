import { Client, Connection, Packet, Message } from "../types";
import { CosmosEvent, CosmosMessage } from "@subql/types-cosmos";
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenConfirm,
} from "../types/proto-interfaces/ibc/core/connection/v1/tx";

export async function handleMsgConOpenAck(
  msg: CosmosMessage<MsgConnectionOpenAck>
): Promise<void> {
  const clientId =
    msg.tx.tx.events
      .find((event) => event.type === "connection_open_ack")
      ?.attributes.find((attr) => attr.key === "client_id")
      ?.value.toString() || "";

  const client = await Client.get(`${msg.block.header.chainId}_${clientId}`);
  if (client === undefined) {
    logger.info(`Client not found: ${msg.block.header.chainId}_${clientId}`);
    return;
  }
  const connection = Connection.create({
    id: `${msg.block.header.chainId}_${msg.msg.decodedMsg.connectionId}`,
    connectionId: msg.msg.decodedMsg.connectionId,
    chainId: msg.block.header.chainId,
    clientId: client.id,
    counterpartyClientId:
      msg.tx.tx.events
        .find((event) => event.type === "connection_open_ack")
        ?.attributes.find((attr) => attr.key === "counterparty_client_id")
        ?.value.toString() || "",
    counterpartyChainId: client?.counterpartyChainId || "",
    counterpartyConnectionId:
      msg.tx.tx.events
        .find((event) => event.type === "connection_open_ack")
        ?.attributes.find((attr) => attr.key === "counterparty_connection_id")
        ?.value.toString() || "",
  });
  await connection.save();
}

export async function handleMsgConOpenConfirm(
  msg: CosmosMessage<MsgConnectionOpenConfirm>
): Promise<void> {
  const clientId =
    msg.tx.tx.events
      .find((event) => event.type === "connection_open_confirm")
      ?.attributes.find((attr) => attr.key === "client_id")
      ?.value.toString() || "";

  const client = await Client.get(`${msg.block.header.chainId}_${clientId}`);
  if (client === undefined) {
    logger.info(`Client not found: ${msg.block.header.chainId}_${clientId}`);
    return;
  }
  const connection = Connection.create({
    id: `${msg.block.header.chainId}_${msg.msg.decodedMsg.connectionId}`,
    connectionId: msg.msg.decodedMsg.connectionId,
    chainId: msg.block.header.chainId,
    clientId: client.id,
    counterpartyClientId:
      msg.tx.tx.events
        .find((event) => event.type === "connection_open_confirm")
        ?.attributes.find((attr) => attr.key === "counterparty_client_id")
        ?.value.toString() || "",
    counterpartyChainId: client?.counterpartyChainId || "",
    counterpartyConnectionId:
      msg.tx.tx.events
        .find((event) => event.type === "connection_open_confirm")
        ?.attributes.find((attr) => attr.key === "counterparty_connection_id")
        ?.value.toString() || "",
  });
  await connection.save();
}
