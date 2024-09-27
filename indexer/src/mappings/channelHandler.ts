import {
  Client,
  Connection,
  Packet,
  Message,
  Channel,
} from "../types";
import { CosmosEvent, CosmosMessage } from "@subql/types-cosmos";

import {
  MsgChannelOpenConfirm,
  MsgChannelOpenAck,
} from "../types/proto-interfaces/ibc/core/channel/v1/tx";

export async function handleMsgChanOpenAck(
  msg: CosmosMessage<MsgChannelOpenAck>
): Promise<void> {
  const connectionId =
    msg.tx.tx.events
      .find((event) => event.type === "channel_open_ack")
      ?.attributes.find((attr) => attr.key === "connection_id")
      ?.value.toString() || "";

  const connection = await Connection.get(
    `${msg.block.header.chainId}_${connectionId}`
  );
  if (connection === undefined) {
    logger.info(
      `Connection not found: ${msg.block.header.chainId}_${connectionId}`
    );
    return;
  }
  const channel = Channel.create({
    id: `${msg.block.header.chainId}_${msg.msg.decodedMsg.portId}_${msg.msg.decodedMsg.channelId}`,
    chainId: msg.block.header.chainId,
    portId: msg.msg.decodedMsg.portId,
    channelId: msg.msg.decodedMsg.channelId,
    connectionId: `${msg.block.header.chainId}_${connectionId}`,
    counterpartyPortId:
      msg.tx.tx.events
        .find((event) => event.type === "channel_open_ack")
        ?.attributes.find((attr) => attr.key === "counterparty_port_id")
        ?.value.toString() || "",
    counterpartyChannelId:
      msg.tx.tx.events
        .find((event) => event.type === "channel_open_ack")
        ?.attributes.find((attr) => attr.key === "counterparty_channel_id")
        ?.value.toString() || "",
    counterpartyChainId: connection?.counterpartyChainId || "",
  });
  await channel.save();
}

export async function handleMsgChanOpenConfirm(
  msg: CosmosMessage<MsgChannelOpenConfirm>
): Promise<void> {
  const connectionId =
    msg.tx.tx.events
      .find((event) => event.type === "channel_open_confirm")
      ?.attributes.find((attr) => attr.key === "connection_id")
      ?.value.toString() || "";

  const connection = await Connection.get(
    `${msg.block.header.chainId}_${connectionId}`
  );
  if (connection === undefined) {
    logger.info(
      `Connection not found: ${msg.block.header.chainId}_${connectionId}`
    );
    return;
  }
  const channel = Channel.create({
    id: `${msg.block.header.chainId}_${msg.msg.decodedMsg.portId}_${msg.msg.decodedMsg.channelId}`,
    chainId: msg.block.header.chainId,
    portId: msg.msg.decodedMsg.portId,
    channelId: msg.msg.decodedMsg.channelId,
    connectionId: `${msg.block.header.chainId}_${connectionId}`,
    counterpartyPortId:
      msg.tx.tx.events
        .find((event) => event.type === "channel_open_confirm")
        ?.attributes.find((attr) => attr.key === "counterparty_port_id")
        ?.value.toString() || "",
    counterpartyChannelId:
      msg.tx.tx.events
        .find((event) => event.type === "channel_open_confirm")
        ?.attributes.find((attr) => attr.key === "counterparty_channel_id")
        ?.value.toString() || "",
    counterpartyChainId: connection?.counterpartyChainId || "",
  });
  await channel.save();
}
