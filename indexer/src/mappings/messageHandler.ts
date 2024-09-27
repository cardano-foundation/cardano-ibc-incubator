import { CosmosMessage } from "@subql/types-cosmos";
import {
  MsgAcknowledgement,
  MsgRecvPacket,
} from "../types/proto-interfaces/ibc/core/channel/v1/tx";
import {
  Channel,
  Message,
  MsgType as MessageType,
  Packet,
  PacketFlow,
  PacketFlowProcess,
} from "../types";
import { MsgTransfer } from "../types/proto-interfaces/ibc/applications/transfer/v1/tx";
import { getCounterChainFromChannel, getPathFromDenom } from "../query";
import crypto from "crypto";

export async function handleMsgAckPacket(
  msg: CosmosMessage<MsgAcknowledgement>
): Promise<void> {
  // find packet
  const chainId = msg.block.header.chainId;
  const sourcePort = msg.msg.decodedMsg.packet.sourcePort.toString();
  const sourceChannel = msg.msg.decodedMsg.packet.sourceChannel.toString();
  const sequence = msg.msg.decodedMsg.packet.sequence.toString();
  const packet = await Packet.get(
    `${chainId}_${sourcePort}_${sourceChannel}_${sequence}`
  );
  if (packet === undefined) {
    logger.info(
      `Packet not found: ${chainId}_${sourcePort}_${sourceChannel}_${sequence}`
    );
    return;
  }
  // create ack packet
  const ackMsg = Message.create({
    id: `${chainId}_${msg.tx.hash}_${msg.idx}_${MessageType.AcknowledgePacket}`,
    chainId: chainId,
    code: BigInt(msg.tx.tx.code),
    txHash: msg.tx.hash,
    msgIdx: BigInt(msg.idx),
    sender: msg.msg.decodedMsg.signer.toString(),
    // receiver: "",
    msgType: MessageType.AcknowledgePacket,
    packetId: `${chainId}_${sourcePort}_${sourceChannel}_${sequence}`,
    time: BigInt(msg.block.header.time.getTime()),
    gas: msg.tx.tx.gasUsed,
  });
  // logger.info(`AcknowledgePacket: ${ackMsg.id}`);
  await ackMsg.save();
  // update packetflow
  const packetFlow = await PacketFlow.get(packet.id);
  if (packetFlow !== undefined) {
    packetFlow.toTxHash = msg.tx.hash;
    packetFlow.updatedTime = BigInt(msg.block.header.time.getTime());
    packetFlow.status =
      BigInt(msg.tx.tx.code) === BigInt(0)
        ? PacketFlowProcess.success
        : PacketFlowProcess.failed;
    packetFlow.endTime = BigInt(msg.block.header.time.getTime());
    await packetFlow.save();
    // logger.info(`PacketFlow ack: id: ${packetFlow.id}`);
    // logger.info(`PacketFlow ack: toTxHash: ${packetFlow.toTxHash}`);
    // logger.info(`PacketFlow ack: status: ${packetFlow.status}`);
    // logger.info(`PacketFlow ack: endtime: ${packetFlow.endTime}`);
  }
}

/**
 * handleMessageRecvPacket
 * create new message with correct packet
 * if this message have send event -> create new send packet
 * and create new message with correct packet
 * @param msg
 * @returns
 */
export async function handleMsgRecvPacket(
  msg: CosmosMessage<MsgRecvPacket>
): Promise<void> {
  const chainId = msg.block.header.chainId;
  const sourcePort = msg.msg.decodedMsg.packet.sourcePort.toString();
  const sourceChannel = msg.msg.decodedMsg.packet.sourceChannel.toString();
  const sequence = msg.msg.decodedMsg.packet.sequence.toString();
  let sourceChain = "chainId";
  const destPort = msg.msg.decodedMsg.packet.destinationPort.toString();
  const destChannel = msg.msg.decodedMsg.packet.destinationChannel.toString();
  //   // cheat for now - khanhdt
  //   if (sourcePort === "transfer") {
  //     if (chainId === "sidechain") {
  //       sourceChain = "localosmosis";
  //     } else {
  //       sourceChain = "sidechain";
  //     }
  //   } else {
  //     sourceChain = "42";
  //   }
  const recvChannel = await Channel.get(
    `${chainId}_${destPort}_${destChannel}`
  );

  if (recvChannel === undefined) {
    logger.info(
      `Channel not found in database: ${chainId}_${destPort}_${destChannel}`
    );
    const response = await getCounterChainFromChannel(
      chainId,
      destChannel,
      destPort
    );
    if (response !== undefined) {
      sourceChain = response;
    }
  } else {
    sourceChain = recvChannel.counterpartyChainId;
  }

  let packet = await Packet.get(
    `${sourceChain}_${sourcePort}_${sourceChannel}_${sequence}`
  );
  const base64Data = Buffer.from(msg.msg.decodedMsg.packet.data).toString();
  if (packet === undefined) {
    packet = Packet.create({
      id: `${sourceChain}_${sourcePort}_${sourceChannel}_${sequence}`,
      sequence: BigInt(sequence),
      srcChain: sourceChain,
      srcPort: sourcePort,
      srcChannel: sourceChannel,
      dstChain: chainId,
      dstPort: destPort,
      dstChannel: destChannel,
      data: base64Data,
      parentPacketId: undefined,
      module: sourcePort === "transfer" ? "transfer" : "",
    });
    await packet.save();
  }
  // const packetFlow = await PacketFlow.get(packet.id);
  // if (packetFlow !== undefined) {
  //   packetFlow.updatedTime = BigInt(msg.block.header.time.getTime());
  //   packetFlow.status =
  //     Number(msg.tx.tx.code) === 0
  //       ? PacketFlowProcess.processing
  //       : PacketFlowProcess.failed;
  //   packetFlow.endTime =
  //     Number(msg.tx.tx.code) === 0
  //       ? undefined
  //       : BigInt(msg.block.header.time.getTime());
  //   await packetFlow.save();
  // }
  // create msg type recv

  const recvMsg = Message.create({
    id: `${chainId}_${msg.tx.hash}_${msg.idx}_${MessageType.RecvPacket}`,
    chainId: chainId,
    code: BigInt(msg.tx.tx.code),
    txHash: msg.tx.hash,
    msgIdx: BigInt(msg.idx),
    sender: msg.msg.decodedMsg.signer.toString(),
    msgType: MessageType.RecvPacket,
    packetId: `${sourceChain}_${sourcePort}_${sourceChannel}_${sequence}`,
    time: BigInt(msg.block.header.time.getTime()),
    gas: msg.tx.tx.gasUsed,
  });
  const writeAckEvent = msg.tx.tx.events.find(
    (event) => event.type === "write_acknowledgement"
  );

  const dataObj = JSON.parse(base64Data);
  // logger.info(`Data object: ${JSON.stringify(dataObj)}`);
  // const saveData = JSON.parse(recvMsg.data || "{}");
  const saveData = {
    transfer: {
      in: {
        amount: dataObj.amount,
        path: dataObj.denom,
        token: dataObj.denom.includes("/")
          ? `ibc/${crypto
              .createHash("sha256")
              .update(dataObj.denom)
              .digest("hex")}`
          : dataObj.denom,
      },
      out: {
        amount: "",
        path: "",
        token: "",
      },
    },
    packet_ack: {},
  };
  if (writeAckEvent) {
    const acknowledgement =
      writeAckEvent.attributes
        .find((attr) => attr.key === "packet_ack")
        ?.value.toString() || "";
    // recvMsg.data = JSON.stringify({ packet_ack: acknowledgement });
    saveData.packet_ack = JSON.parse(acknowledgement);
  }
  const lastTransferEvent = msg.tx.tx.events
    .filter((event) => event.type === "transfer")
    .pop();
  if (lastTransferEvent) {
    const value =
      lastTransferEvent.attributes
        .find((attr) => attr.key === "amount")
        ?.value.toString() || "";
    const containsNonNumber = /[^\d]/.exec(value);
    if (containsNonNumber) {
      const valueIndex = value.indexOf(containsNonNumber[0]);
      const first = value.slice(0, valueIndex);
      const second = value.slice(valueIndex);
      const path = await getPathFromDenom(chainId, second.slice(4));
      saveData.transfer.out.amount = first;
      saveData.transfer.out.path = path || "";
      saveData.transfer.out.token = second;
    }
  }
  recvMsg.data = JSON.stringify(saveData);

  await recvMsg.save();

  // check if there is any send event
  for (const event of msg.tx.tx.events) {
    if (event.type === "send_packet") {
      const sendSequence =
        event.attributes
          .find((attr) => attr.key === "packet_sequence")
          ?.value.toString() || "";
      const sendSourcePort =
        event.attributes
          .find((attr) => attr.key === "packet_src_port")
          ?.value.toString() || "";
      const sendSourceChannel =
        event.attributes
          .find((attr) => attr.key === "packet_src_channel")
          ?.value.toString() || "";
      const sendDestPort =
        event.attributes
          .find((attr) => attr.key === "packet_dst_port")
          ?.value.toString() || "";
      const sendDestChannel =
        event.attributes
          .find((attr) => attr.key === "packet_dst_channel")
          ?.value.toString() || "";
      const sendData =
        event.attributes
          .find((attr) => attr.key === "packet_data")
          ?.value.toString() || "";
      let sendDestChain = "chainId";

      // cheat for now - khanhdt
      //   if (sendDestPort === "transfer") {
      //     if (chainId === "sidechain") {
      //       sendDestChain = "localosmosis";
      //     } else {
      //       sendDestChain = "sidechain";
      //     }
      //   } else {
      //     sendDestChain = "42";
      //   }
      const sendChannel = await Channel.get(
        `${chainId}_${sendSourcePort}_${sendSourceChannel}`
      );
      if (sendChannel === undefined) {
        logger.info(
          `Channel not found in database: ${chainId}_${sendSourcePort}_${sendSourceChannel}`
        );
        const response = await getCounterChainFromChannel(
          chainId,
          sendSourceChannel,
          sendSourcePort
        );
        if (response !== undefined) {
          sendDestChain = response;
        }
      } else {
        sendDestChain = sendChannel.counterpartyChainId;
      }

      const sendPacket = Packet.create({
        id: `${chainId}_${sendSourcePort}_${sendSourceChannel}_${sendSequence}`,
        sequence: BigInt(sendSequence),
        srcChain: chainId,
        srcPort: sendSourcePort,
        srcChannel: sendSourceChannel,
        dstChain: sendDestChain,
        dstPort: sendDestPort,
        dstChannel: sendDestChannel,
        data: sendData,
        parentPacketId: packet.id,
        module: sourcePort === "transfer" ? "transfer" : "",
      });
      // logger.info(`SendPacket: ${sendPacket.id}, ${sendPacket.parentPacketId}`);
      await sendPacket.save();
    
      // create send Msg
      const sendMsg = Message.create({
        id: `${chainId}_${msg.tx.hash}_${msg.idx}_${MessageType.SendPacket}`,
        chainId: chainId,
        code: BigInt(msg.tx.tx.code),
        txHash: msg.tx.hash,
        msgIdx: BigInt(msg.idx),
        sender: msg.msg.decodedMsg.signer.toString(),
        msgType: MessageType.SendPacket,
        packetId: `${chainId}_${sendSourcePort}_${sendSourceChannel}_${sendSequence}`,
        time: BigInt(msg.block.header.time.getTime()),
        gas: msg.tx.tx.gasUsed,
      });
      await sendMsg.save();

    }
  }
}

export async function handleMsgTransfer(
  msg: CosmosMessage<MsgTransfer>
): Promise<void> {
  // create packet for transfer
  const chainId = msg.block.header.chainId;
  const srcPort = msg.msg.decodedMsg.sourcePort.toString();
  const srcChannel = msg.msg.decodedMsg.sourceChannel.toString();
  const sequence =
    msg.tx.tx.events
      .find((event) => event.type === "send_packet")
      ?.attributes.find((attr) => attr.key === "packet_sequence")
      ?.value.toString() || "";
  const dstPort =
    msg.tx.tx.events
      .find((event) => event.type === "send_packet")
      ?.attributes.find((attr) => attr.key === "packet_dst_port")
      ?.value.toString() || "";
  const dstChannel =
    msg.tx.tx.events
      .find((event) => event.type === "send_packet")
      ?.attributes.find((attr) => attr.key === "packet_dst_channel")
      ?.value.toString() || "";
  const packetData =
    msg.tx.tx.events
      .find((event) => event.type === "send_packet")
      ?.attributes.find((attr) => attr.key === "packet_data")
      ?.value.toString() || "";
  const channel = await Channel.get(`${chainId}_${srcPort}_${srcChannel}`);
  let counterChainId = "chainId";
  if (channel === undefined) {
    logger.info(
      `Channel not found in database: ${chainId}_${srcPort}_${srcChannel}`
    );
    const response = await getCounterChainFromChannel(
      chainId,
      srcChannel,
      srcPort
    );
    if (response !== undefined) {
      counterChainId = response;
    }
  } else {
    counterChainId = channel.counterpartyChainId;
  }

  const packet = Packet.create({
    id: `${chainId}_${srcPort}_${srcChannel}_${sequence}`,
    sequence: BigInt(sequence),
    srcChain: chainId,
    srcPort: srcPort,
    srcChannel: srcChannel,
    dstChain: counterChainId,
    dstPort: dstPort,
    dstChannel: dstChannel,
    data: packetData,
    parentPacketId: undefined,
    module: srcPort === "transfer" ? "transfer" : "",
  });
  await packet.save();

  let packetFlow = await PacketFlow.get(packet.id);
  if (packetFlow === undefined) {
    packetFlow = PacketFlow.create({
      id: `${chainId}_${srcPort}_${srcChannel}_${sequence}`,
      fromTxHash: msg.tx.hash,
      fromAddress: msg.msg.decodedMsg.sender.toString(),
      fromChainId: chainId,
      toAddress: msg.msg.decodedMsg.receiver.toString(),
      status:
        Number(msg.tx.tx.code) === 0
          ? PacketFlowProcess.processing
          : PacketFlowProcess.failed,
      createTime: BigInt(msg.block.header.time.getTime()),
      endTime:
        Number(msg.tx.tx.code) === 0
          ? undefined
          : BigInt(msg.block.header.time.getTime()),
      updatedTime: BigInt(msg.block.header.time.getTime()),
    });
  }

  await packetFlow.save();

  // create message for transfer

  const message = Message.create({
    id: `${chainId}_${msg.tx.hash}_${msg.idx}_${MessageType.SendPacket}`,
    chainId: chainId,
    code: BigInt(msg.tx.tx.code),
    txHash: msg.tx.hash,
    msgIdx: BigInt(msg.idx),
    sender: msg.msg.decodedMsg.sender.toString(),
    receiver: msg.msg.decodedMsg.receiver.toString(),
    msgType: MessageType.SendPacket,
    packetId: `${chainId}_${srcPort}_${srcChannel}_${sequence}`,
    time: BigInt(msg.block.header.time.getTime()),
    gas: msg.tx.tx.gasUsed,
  });

  await message.save();
}
