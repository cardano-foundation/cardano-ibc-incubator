// @ts-nocheck
import { CosmosEvent,CosmosMessage } from "@subql/types-cosmos";

import {
  MsgChannelOpenConfirm,
  MsgChannelOpenAck,
} from "../types/proto-interfaces/ibc/core/channel/v1/tx";

import {
  AlonzoRedeemerList,
  MultiEraBlock as CardanoBlock,
} from '@dcspark/cardano-multiplatform-multiera-lib-nodejs';
import * as handler from '../contracts/handler.json';
import {
  CHANNEL_TOKEN_PREFIX,
  CHANNEL_ID_PREFIX,
} from '../constants';
import {ChannelDatum} from '../ibc-types/core/ics_004/channel_datum/ChannelDatum';
import {MintChannelRedeemer} from '../ibc-types/core/ics_004/channel_redeemer/MintChannelRedeemer';
import {SpendChannelRedeemer} from '../ibc-types/core/ics_004/channel_redeemer/SpendChannelRedeemer';
import {
  Event,
  Channel,
  EventAttribute,
  EventType,
  CardanoIbcAsset,
  CardanoTransfer,
  MsgType,
  Packet,
  PacketFlow,
  PacketFlowProcess,
} from '../types';
import {EventAttributeChannel} from '../constants/eventAttributes';
import {convertHex2String, convertString2Hex, hexToBytes} from '../utils/hex';
import {getDenomPrefix} from '../utils/helper';
import {Connection, Message} from '../types/models';
import {TxOutput} from "./cardanoObject";

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

export async function handleParseCardanoChannelEvents(
  txOutput: TxOutput,
  redeemers: AlonzoRedeemerList,
  blockHeight: bigint,
  slot: bigint,
  txWitness: BabbageTransactionWitnessSet
): Promise<void> {
  try {
    // case channel init

    const channelDatum = decodeCborHex(txOutput.datum, ChannelDatum);
    let eventType: EventType = EventType.ChannelOpenInit;
    let eventAttributes: EventAttribute[] = [];
    const currentChannelId = getIdFromTokenAssets(txOutput.assets, handler.handlerAuthToken, CHANNEL_TOKEN_PREFIX);
    const signer = await getSigner(txWitness);
    const txHash = txOutput.hash.toUpperCase();
    if (channelDatum.state.channel.state == 'Init') {
      const mintChannelRedeemerHex = redeemers.get(2).data().to_cbor_hex();
      const mintChannelRedeemer = decodeCborHex(mintChannelRedeemerHex, MintChannelRedeemer);
      if (mintChannelRedeemer.valueOf().hasOwnProperty('ChanOpenInit')) {
        eventType = EventType.ChannelOpenInit;
        eventAttributes = extractChannelEventAttributes(channelDatum, currentChannelId);
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (mintChannelRedeemer.valueOf().hasOwnProperty('ChanOpenTry')) {
        eventType = EventType.ChannelOpenTry;
        eventAttributes = extractChannelEventAttributes(channelDatum, currentChannelId);
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
    }
    // channel ack
    if (channelDatum.state.channel.state == 'Open') {
      const spendChannelRedeemerHex = redeemers.get(0).data().to_cbor_hex();
      const spendChannelRedeemer = decodeCborHex(spendChannelRedeemerHex, SpendChannelRedeemer);
      if (spendChannelRedeemer.valueOf().hasOwnProperty('ChanOpenAck')) {
        eventType = EventType.ChannelOpenAck;
        eventAttributes = extractChannelEventAttributes(channelDatum, currentChannelId);
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('ChanOpenConfirm')) {
        eventType = EventType.ChannelOpenConfirm;
        eventAttributes = extractChannelEventAttributes(channelDatum, currentChannelId);
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('ChanCloseConfirm')) {
        eventType = EventType.ChannelCloseConfirm;
        eventAttributes = extractChannelEventAttributes(channelDatum, currentChannelId);
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('RecvPacket')) {
        eventType = EventType.RecvPacket;
        eventAttributes = extractCardanoPacketEventAttributes(channelDatum, spendChannelRedeemer);
        await saveCardanoIBCAssets(eventType, eventAttributes);
        await saveCardanoTransfers(eventType, txHash, blockHeight, slot, eventAttributes);
        await savePacket(eventType, txHash, blockHeight, slot, eventAttributes);
        await saveMessage(eventType, txHash, blockHeight, slot, txOutput.fee, signer, eventAttributes);
        await savePacketFlow(eventType, txHash, blockHeight, slot, signer, eventAttributes);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('TimeoutPacket')) {
        eventType = EventType.TimeoutPacket;
        eventAttributes = extractCardanoPacketEventAttributes(channelDatum, spendChannelRedeemer);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('AcknowledgePacket')) {
        eventType = EventType.AcknowledgePacket;
        eventAttributes = extractCardanoPacketEventAttributes(channelDatum, spendChannelRedeemer);
        await saveCardanoTransfers(eventType, txHash, blockHeight, slot, eventAttributes);
        await saveMessage(eventType, txHash, blockHeight, slot, txOutput.fee, signer, eventAttributes);
        await savePacketFlow(eventType, txHash, blockHeight, slot, signer, eventAttributes);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('SendPacket')) {
        eventType = EventType.SendPacket;
        // const packetData = getPacketData(spendChannelRedeemer)
        eventAttributes = extractCardanoPacketEventAttributes(channelDatum, spendChannelRedeemer);
        await saveCardanoTransfers(eventType, txHash, blockHeight, slot, eventAttributes);
        await savePacket(eventType, txHash, blockHeight, slot, eventAttributes);
        await saveMessage(eventType, txHash, blockHeight, slot, txOutput.fee, signer, eventAttributes);
        await savePacketFlow(eventType, txHash, blockHeight, slot, signer, eventAttributes);
      }
      if (eventType == EventType.ChannelOpenInit) return;
    }

    const event = Event.create({
      id: `${txHash}-${txOutput.txIndex}`,
      blockHeight: blockHeight,
      txHash: txHash,
      type: eventType,
      eventAttributes: eventAttributes,
    });
    await event.save();
  } catch (error) {
    logger.info('Handle Parse Channel Event ERR: ', error);
  }
}

function extractChannelEventAttributes(channelDatum: ChannelDatum, channelId: string): EventAttribute[] {
  const connectionId = Buffer.from(hexToBytes(channelDatum.state.channel.connection_hops[0])).toString();
  return [
    {
      key: EventAttributeChannel.AttributeKeyConnectionID,
      value: connectionId,
    },
    {
      key: EventAttributeChannel.AttributeKeyPortID,
      value: convertHex2String(channelDatum.port_id),
    },
    {
      key: EventAttributeChannel.AttributeKeyChannelID,
      value: `${CHANNEL_ID_PREFIX}-${channelId}`,
    },
    {
      key: EventAttributeChannel.AttributeVersion,
      value: convertHex2String(channelDatum.state.channel.version),
    },
    {
      key: EventAttributeChannel.AttributeCounterpartyChannelID,
      value: convertHex2String(channelDatum.state.channel.counterparty.channel_id),
    },
    {
      key: EventAttributeChannel.AttributeCounterpartyPortID,
      value: convertHex2String(channelDatum.state.channel.counterparty.port_id),
    },
  ].map(
    (attr) =>
      <EventAttribute>{
        key: attr.key.toString(),
        value: attr.value.toString(),
        index: true,
      }
  );
}

function extractCardanoPacketEventAttributes(
  channelDatum: ChannelDatum,
  channelRedeemer: SpendChannelRedeemer
): EventAttribute[] {
  let packetData: PacketSchema;
  let acknowledgement = '';
  if (channelRedeemer.hasOwnProperty('RecvPacket')) packetData = channelRedeemer['RecvPacket']?.packet as unknown;
  if (channelRedeemer.hasOwnProperty('SendPacket')) packetData = channelRedeemer['SendPacket']?.packet as unknown;
  if (channelRedeemer.hasOwnProperty('AcknowledgePacket')) {
    packetData = channelRedeemer['AcknowledgePacket']?.packet as unknown;
    acknowledgement = channelRedeemer['AcknowledgePacket']?.acknowledgement;
  }
  if (channelRedeemer.hasOwnProperty('TimeoutPacket')) packetData = channelRedeemer['TimeoutPacket']?.packet as unknown;
  return [
    {
      key: EventAttributeChannel.AttributeKeyData,
      value: convertHex2String(packetData.data),
    },
    {
      key: EventAttributeChannel.AttributeKeyAck,
      value: acknowledgement,
    },
    {
      key: EventAttributeChannel.AttributeKeyDataHex,
      value: packetData.data,
    },
    {
      key: EventAttributeChannel.AttributeKeyAckHex,
      value: acknowledgement,
    },
    {
      key: EventAttributeChannel.AttributeKeyTimeoutHeight,
      value: `${packetData.timeout_height.revision_number}-${packetData.timeout_height.revision_height}`,
    },
    {
      key: EventAttributeChannel.AttributeKeyTimeoutTimestamp,
      value: packetData.timeout_timestamp,
    },
    {
      key: EventAttributeChannel.AttributeKeySequence,
      value: packetData.sequence,
    },
    {
      key: EventAttributeChannel.AttributeKeySrcPort,
      value: convertHex2String(packetData.source_port),
    },
    {
      key: EventAttributeChannel.AttributeKeySrcChannel,
      value: convertHex2String(packetData.source_channel),
    },
    {
      key: EventAttributeChannel.AttributeKeyDstPort,
      value: convertHex2String(packetData.destination_port),
    },
    {
      key: EventAttributeChannel.AttributeKeyDstChannel,
      value: convertHex2String(packetData.destination_channel),
    },
    {
      key: EventAttributeChannel.AttributeKeyChannelOrdering,
      value: channelDatum.state.channel.ordering,
    },
    {
      key: EventAttributeChannel.AttributeKeyConnection,
      value: convertHex2String(channelDatum.state.channel.connection_hops[0]),
    },
  ].map(
    (attr) =>
      <EventAttribute>{
        key: attr.key.toString(),
        value: attr.value.toString(),
        index: true,
      }
  );
}

function getDenomBase(denom: string): string {
  const steps = denom.split('/');
  return steps.pop();
}

async function getSigner(txWitness: BabbageTransactionWitnessSet) {
  let vkeys = [];
  const vkeywitnesses = txWitness.vkeywitnesses();
  if (typeof vkeywitnesses !== 'undefined') {
    for(let i = 0 ; i< vkeywitnesses.len();i++) {
      const txWitnes = vkeywitnesses.get(i).vkey().hash().to_hex();
      vkeys.push(txWitnes);
    }
  }
  return vkeys.join(',');
}

async function saveChannel(eventType: EventType, eventAttribute: EventAttribute[], channelDatum: ChannelDatum) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });

  const network = await getProjectNetwork();
  const chainId = network.networkMagic;

  const connectionUnit = `${chainId}_${map.get(EventAttributeChannel.AttributeKeyConnectionID)}`;
  const connection = await Connection.get(connectionUnit);

  let channel = Channel.create({
    id: `${chainId}_${map.get(EventAttributeChannel.AttributeKeyPortID)}_${map.get(EventAttributeChannel.AttributeKeyChannelID)}`,
    chainId: chainId,
    portId: map.get(EventAttributeChannel.AttributeKeyPortID),
    channelId: map.get(EventAttributeChannel.AttributeKeyChannelID),
    connectionId: connectionUnit,
    counterpartyPortId: map.get(EventAttributeChannel.AttributeCounterpartyPortID),
    counterpartyChannelId: map.get(EventAttributeChannel.AttributeCounterpartyChannelID),
    counterpartyChainId: connection?.counterpartyChainId,
  });
  await channel.save();
}

async function saveCardanoIBCAssets(eventType: EventType, eventAttribute: EventAttribute[]) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });
  const packetData = map.get(EventAttributeChannel.AttributeKeyData);
  const packetDataObject = JSON.parse(packetData);
  switch (eventType) {
    case EventType.RecvPacket:
      const denomRecv = packetDataObject?.denom;
      const voucherTokenRecvPrefix = getDenomPrefix(
        map.get(EventAttributeChannel.AttributeKeyDstPort),
        map.get(EventAttributeChannel.AttributeKeyDstChannel)
      );
      // check case mint
      if (!denomRecv.startsWith(voucherTokenRecvPrefix)) {
        const prefixDenom = convertString2Hex(voucherTokenRecvPrefix + denomRecv);
        const voucherTokenName = hashSha3_256(prefixDenom);
        const voucherTokenUnit = handler.validators.mintVoucher.scriptHash + voucherTokenName;
        const cardanoIbcAsset = await store.get(`CardanoIbcAsset`, `${voucherTokenUnit}`);
        if (!cardanoIbcAsset) {
          const denomPath = getPathTrace(
            map.get(EventAttributeChannel.AttributeKeyDstPort),
            map.get(EventAttributeChannel.AttributeKeyDstChannel),
            packetDataObject?.denom
          );
          const denomBase = getDenomBase(packetDataObject?.denom);

          const newAsset = CardanoIbcAsset.create({
            id: voucherTokenUnit,
            accountAddress: packetDataObject?.receiver,
            denom: denomBase,
            voucherTokenName: voucherTokenName,
            connectionId: map.get(EventAttributeChannel.AttributeKeyConnection),
            srcPort: map.get(EventAttributeChannel.AttributeKeySrcPort),
            srcChannel: map.get(EventAttributeChannel.AttributeKeySrcChannel),
            dstPort: map.get(EventAttributeChannel.AttributeKeyDstPort),
            dstChannel: map.get(EventAttributeChannel.AttributeKeyDstChannel),
            path: denomPath,
          });
          await newAsset.save();
        }
      }
  }
}

async function saveCardanoTransfers(
  eventType: EventType,
  txHash: String,
  blockHeight: BigInt,
  slot: BigInt,
  eventAttribute: EventAttribute[]
) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });
  const packetData = map.get(EventAttributeChannel.AttributeKeyData);
  const packetDataObject = JSON.parse(packetData);

  const voucherTokenRecvPrefix = getDenomPrefix(
    map.get(EventAttributeChannel.AttributeKeyDstPort),
    map.get(EventAttributeChannel.AttributeKeyDstChannel)
  );

  const prefixDenom = convertString2Hex(voucherTokenRecvPrefix + packetDataObject?.denom);
  const voucherTokenName = hashSha3_256(prefixDenom);
  const voucherTokenUnit = handler.validators.mintVoucher.scriptHash + voucherTokenName;

  let newCardanoTransfer = CardanoTransfer.create({
    id: txHash,
    ibcTokenUnit: voucherTokenUnit,
    blockHeight: blockHeight,
    slot: slot,
    sender: packetDataObject?.sender,
    receiver: packetDataObject?.receiver,
    sequence: map.get(EventAttributeChannel.AttributeKeySequence),
    srcPort: map.get(EventAttributeChannel.AttributeKeySrcPort),
    srcChannel: map.get(EventAttributeChannel.AttributeKeySrcChannel),
    dstPort: map.get(EventAttributeChannel.AttributeKeyDstPort),
    dstChannel: map.get(EventAttributeChannel.AttributeKeyDstChannel),
    connectionId: map.get(EventAttributeChannel.AttributeKeyConnection),
    msgType: MsgType.SendPacket,
    amount: packetDataObject?.amount,
    denom: packetDataObject?.denom,
    memo: packetDataObject?.memo,
  });

  if (eventType == EventType.RecvPacket) {
    newCardanoTransfer.msgType = MsgType.RecvPacket;
  }
  if (eventType == EventType.AcknowledgePacket) {
    newCardanoTransfer.msgType = MsgType.AcknowledgePacket;
  }

  await newCardanoTransfer.save();
}

async function savePacket(
  eventType: EventType,
  txHash: String,
  blockHeight: BigInt,
  slot: BigInt,
  eventAttribute: EventAttribute[]
) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });
  const packetData = map.get(EventAttributeChannel.AttributeKeyData);
  const packetDataObject = JSON.parse(packetData);

  const network = await getProjectNetwork();
  const srcChainId = network.networkMagic;

  if (eventType === EventType.RecvPacket) {
    const channelUnit = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeyDstPort)}_${map.get(EventAttributeChannel.AttributeKeyDstChannel)}`;
    const channel = await Channel.get(channelUnit);

    const dstChainId = channel?.counterpartyChainId;
    const packetId = `${dstChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;

    const packet = await Packet.get(packetId);
    if (!packet) {
      let newPacket = Packet.create({
        id: packetId,
        sequence: map.get(EventAttributeChannel.AttributeKeySequence),
        srcChain: dstChainId,
        srcPort: map.get(EventAttributeChannel.AttributeKeySrcPort),
        srcChannel: map.get(EventAttributeChannel.AttributeKeySrcChannel),
        dstChain: srcChainId,
        dstPort: map.get(EventAttributeChannel.AttributeKeyDstPort),
        dstChannel: map.get(EventAttributeChannel.AttributeKeyDstChannel),
        data: packetData,
      });

      if (newPacket.srcPort == 'port-100' || newPacket.srcPort == 'transfer') {
        newPacket.module = 'transfer';
      } else {
        newPacket.module = newPacket.srcPort;
      }
      await newPacket.save();
    }
  } else {
    const channelUnit = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}`;
    const channel = await Channel.get(channelUnit);
    const packetId = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;

    let newPacket = Packet.create({
      id: packetId,
      sequence: map.get(EventAttributeChannel.AttributeKeySequence),
      srcChain: srcChainId,
      srcPort: map.get(EventAttributeChannel.AttributeKeySrcPort),
      srcChannel: map.get(EventAttributeChannel.AttributeKeySrcChannel),
      dstChain: channel?.counterpartyChainId,
      dstPort: map.get(EventAttributeChannel.AttributeKeyDstPort),
      dstChannel: map.get(EventAttributeChannel.AttributeKeyDstChannel),
      data: packetData,
    });

    if ( newPacket.srcPort == "port-100" || newPacket.srcPort == "transfer") {
      newPacket.module = "transfer"
    } else {
      newPacket.module = newPacket.srcPort
    }

    await newPacket.save();
  }
}

async function saveMessage(
  eventType: EventType,
  txHash: String,
  blockHeight: BigInt,
  slot: BigInt,
  fee: BigInt,
  signer: String,
  eventAttribute: EventAttribute[]
) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });
  const packetData = map.get(EventAttributeChannel.AttributeKeyData);
  const packetDataObject = JSON.parse(packetData);

  const network = await getProjectNetwork();
  const chainId = network.networkMagic;
  const time = BigInt(network.systemStart) + BigInt(network.slotLength) * BigInt(slot);
  let dataMsgString = ''
  if (eventType == MsgType.RecvPacket) {
    const messageId = `${chainId}_${txHash}_0_${eventType}`;
    const channleUnit = `${chainId}_${map.get(EventAttributeChannel.AttributeKeyDstPort)}_${map.get(EventAttributeChannel.AttributeKeyDstChannel)}`;
    const channel = await Channel.get(channleUnit);
    const counterpartyChainId = channel?.counterpartyChainId;

    const packetUnit = `${counterpartyChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;
    
    const denomRecv = packetDataObject?.denom;
    const voucherTokenRecvPrefix = getDenomPrefix(
      map.get(EventAttributeChannel.AttributeKeyDstPort),
      map.get(EventAttributeChannel.AttributeKeyDstChannel)
    );

    if (!denomRecv.startsWith(voucherTokenRecvPrefix)) {
      const prefixDenom = convertString2Hex(voucherTokenRecvPrefix + denomRecv);
      const voucherTokenName = hashSha3_256(prefixDenom);
      const voucherTokenUnit = handler.validators.mintVoucher.scriptHash + voucherTokenName;

      const denomPath = getPathTrace(
        map.get(EventAttributeChannel.AttributeKeyDstPort),
        map.get(EventAttributeChannel.AttributeKeyDstChannel),
        packetDataObject?.denom
      );

      const denomBase = getDenomBase(packetDataObject?.denom);

      let voucherTokenUnitIn = denomBase

      if(denomBase != packetDataObject?.denom) {
        const hashDenom = hashSha_256(packetDataObject?.denom)
        voucherTokenUnitIn = `ibc/${hashDenom}`
      }

      const dataMessage = {
        transfer: {
          in: {
            token: voucherTokenUnitIn,
            amount: packetDataObject?.amount,
            path: packetDataObject?.denom
          },
          out: {
            token: voucherTokenUnit,
            amount: packetDataObject?.amount,
            path: `${denomPath}/${denomBase}`,
          }
        }
      }
      dataMsgString = JSON.stringify(dataMessage);
    }

    const newMessage = Message.create({
      id: messageId,
      chainId: chainId,
      msgIdx: 0,
      txHash: txHash,
      sender: signer,
      receiver: "",
      msgType: eventType,
      packetId: packetUnit,
      gas: fee,
      time: time,
      code:0,
      data: dataMsgString,
    });
    await newMessage.save();
  } else {
    const messageId = `${chainId}_${txHash}_0_${eventType}`;
    const packetUnit = `${chainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;

    if(eventType == MsgType.SendPacket) {
      const dataMessage = {
        transfer: {
          in: {
            token: packetDataObject?.denom,
            amount: packetDataObject?.amount,
            path: packetDataObject?.denom
          },
          out: {
            token: "",
            amount: "",
            path: "",
          }
        }
      }
      dataMsgString = JSON.stringify(dataMessage);
    }
    const newMessage = Message.create({
      id: messageId,
      chainId: chainId,
      msgIdx: 0,
      txHash: txHash,
      sender: signer,
      receiver: "",
      msgType: eventType,
      packetId: packetUnit,
      gas: fee,
      time: time,
      code:0,
      data: dataMsgString,
    });

    await newMessage.save();
  }
}

function getPathTrace(port: string, channel: string, denom: string): string {
  const steps = denom.split('/');
  const denomBase = steps.pop();
  if (steps.length % 2 != 0) {
    return '';
  }
  const resDenom = denom.slice(0, denom.length - denomBase?.length);
  if (resDenom.length == 0) {
    return `${port}/${channel}`;
  } else {
    let res = `${port}/${channel}/${resDenom}`;
    if (res.endsWith('/')) {
      res = res.slice(0, -1);
    }
    return res;
  }
}

async function savePacketFlow(
  eventType: EventType,
  txHash: String,
  blockHeight: BigInt,
  slot: BigInt,
  signer: String,
  eventAttribute: EventAttribute[]
) {

  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });
  const packetData = map.get(EventAttributeChannel.AttributeKeyData);
  const packetDataObject = JSON.parse(packetData);

  const network = await getProjectNetwork();
  const srcChainId = network.networkMagic;
  const time = BigInt(network.systemStart) + BigInt(network.slotLength) * BigInt(slot);
  if(eventType == EventType.SendPacket) {
    const channelUnit = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}`;
    const channel = await Channel.get(channelUnit);

    const packetFlowId = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;

    const newPacketFlow = PacketFlow.create({
      id: packetFlowId,
      fromTxHash: txHash,
      fromAddress: signer,
      fromChainId: srcChainId,
      status:PacketFlowProcess.processing,
      createTime: time,
      updatedTime: time,
    })

    await newPacketFlow.save();
  }
  else if(eventType == EventType.RecvPacket) {
    // const channelUnit = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeyDstPort)}_${map.get(EventAttributeChannel.AttributeKeyDstChannel)}`;
    // const channel = await Channel.get(channelUnit);

    // const dstChainId = channel?.counterpartyChainId;
    // const packetId = `${dstChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;

    // const packet = await Packet.get(packetId);
    // const packetFlowId = `${dstChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;
    // const packetFlow = await PacketFlow.get(packetFlowId)
    // console.log("savePacketFlow_RecvPacket_" + packetFlowId)
    // console.dir(packetFlow,{depth: 100});
    // if(typeof packetFlow !== 'undefined') {
    //   console.log("case1")
    //   packetFlow.updatedTime = time
    //   packetFlow.status = PacketFlowProcess.processing,
    //   await packetFlow.save();
    // }
    // else {
    //   console.log("case2")
    //   const newPacketFlow = PacketFlow.create({
    //     id: packetFlowId,
    //     toAddress: packetDataObject?.sender,
    //     fromTxHash: "0x",
    //     fromAddress: "0xa",
    //     fromChainId: dstChainId,
    //     createTime: time,
    //     updatedTime: time,
    //     status: PacketFlowProcess.processing,
    //   })
    //   await newPacketFlow.save();
    // }    
  }
  else if(eventType == EventType.AcknowledgePacket) {
    const packetFlowId = `${srcChainId}_${map.get(EventAttributeChannel.AttributeKeySrcPort)}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(EventAttributeChannel.AttributeKeySequence)}`;
    const packetFlow = await PacketFlow.get(packetFlowId);
    packetFlow.toTxHash = txHash;
    packetFlow.toAddress = packetDataObject?.receiver
    packetFlow.endTime=  time;
    packetFlow.updatedTime = time;
    packetFlow.status = PacketFlowProcess.success;

    await packetFlow.save();
  }
}
