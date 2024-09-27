// @ts-nocheck
import { CosmosMessage } from '@subql/types-cosmos';
import { MsgRecvPacket } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import { MsgAcknowledgement } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import { MsgCreateClient } from '../types/proto-interfaces/ibc/core/client/v1/tx';

import {
  MsgConnectionOpenAck,
  MsgConnectionOpenConfirm,
} from '../types/proto-interfaces/ibc/core/connection/v1/tx';
import { MsgChannelOpenConfirm } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import {
  handleMsgConOpenAck,
  handleMsgConOpenConfirm,
} from './connectionHandler';
import {
  handleMsgChanOpenAck,
  handleMsgChanOpenConfirm,
} from './channelHandler';
import { MsgChannelOpenAck } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import { handleMsgClient } from './clientHandler';
import {
  handleMsgAckPacket,
  handleMsgRecvPacket,
  handleMsgTransfer,
} from './messageHandler';
import { MsgTransfer } from '../types/proto-interfaces/ibc/applications/transfer/v1/tx';

// Cardano
import {
  AlonzoRedeemerList,
  BabbageBlock,
  MultiEraBlock as CardanoBlock,
  CoinSelectionStrategyCIP2,
  PlutusData,
} from '@dcspark/cardano-multiplatform-multiera-lib-nodejs';
import * as handler from '../contracts/handler.json';
import {
  CHANNEL_TOKEN_PREFIX,
  CLIENT_PREFIX,
  CONNECTION_TOKEN_PREFIX,
  CHANNEL_ID_PREFIX,
  CONNECTION_ID_PREFIX,
  CLIENT_ID_PREFIX,
} from '../constants';
import { ClientDatum } from '../ibc-types/client/ics_007_tendermint_client/client_datum/ClientDatum';
import { SpendClientRedeemer } from '../ibc-types/client/ics_007_tendermint_client/client_redeemer/SpendClientRedeemer';
import { ConnectionDatum } from '../ibc-types/core/ics_003_connection_semantics/connection_datum/ConnectionDatum';
import { MintConnectionRedeemer } from '../ibc-types/core/ics_003_connection_semantics/connection_redeemer/MintConnectionRedeemer';
import { SpendConnectionRedeemer } from '../ibc-types/core/ics_003_connection_semantics/connection_redeemer/SpendConnectionRedeemer';
import { ChannelDatum } from '../ibc-types/core/ics_004/channel_datum/ChannelDatum';
import { MintChannelRedeemer } from '../ibc-types/core/ics_004/channel_redeemer/MintChannelRedeemer';
import { SpendChannelRedeemer } from '../ibc-types/core/ics_004/channel_redeemer/SpendChannelRedeemer';
import {
  Event,
  Channel,
  Client,
  EventAttribute,
  EventType,
  CardanoIbcAsset,
  ChannelStateType,
  CardanoTransfer,
  MsgType,
  Packet,
} from '../types';
import {
  EventAttributeChannel,
  EventAttributeConnection,
  EventAttributeClient,
} from '../constants/eventAttributes';
import { fromHex } from '@harmoniclabs/uint8array-utils';
import { ClientMessageSchema } from '../ibc-types/client/ics_007_tendermint_client/msgs/ClientMessage';
import {
  Header,
  HeaderSchema,
} from '../ibc-types/client/ics_007_tendermint_client/header/Header';
import { Data } from '../ibc-types/plutus/data';
import { convertHex2String, convertString2Hex, hexToBytes } from '../utils/hex';
import { getDenomPrefix } from '../utils/helper';
import { Connection, Message } from '../types/models';
import { Counterparty } from '../ibc-types/core/ics_003_connection_semantics/types/counterparty/Counterparty';

export async function handleMessageAckPacket(
  msg: CosmosMessage<MsgAcknowledgement>
): Promise<void> {
  await handleMsgAckPacket(msg);
}

export async function handleMessageRecvPacket(
  msg: CosmosMessage<MsgRecvPacket>
): Promise<void> {
  await handleMsgRecvPacket(msg);
}

export async function handleMessageTransferPacket(
  msg: CosmosMessage<MsgTransfer>
): Promise<void> {
  await handleMsgTransfer(msg);
}

export async function handleMessageClient(
  msg: CosmosMessage<MsgCreateClient>
): Promise<void> {
  await handleMsgClient(msg);
}

export async function handleMsgConnectionOpenAck(
  msg: CosmosMessage<MsgConnectionOpenAck>
): Promise<void> {
  await handleMsgConOpenAck(msg);
}

export async function handleMsgConnectionOpenConfirm(
  msg: CosmosMessage<MsgConnectionOpenConfirm>
): Promise<void> {
  await handleMsgConOpenConfirm(msg);
}

export async function handleMsgChannelOpenAck(
  msg: CosmosMessage<MsgChannelOpenAck>
): Promise<void> {
  await handleMsgChanOpenAck(msg);
}

export async function handleMsgChannelOpenConfirm(
  msg: CosmosMessage<MsgChannelOpenConfirm>
): Promise<void> {
  await handleMsgChanOpenConfirm(msg);
}

export async function handleCardanoBlock(cborHex: string): Promise<void> {
  const handlerAuthToken = handler.handlerAuthToken;
  const clientTokenPrefix = generateTokenName(
    handlerAuthToken,
    CLIENT_PREFIX,
    ''
  );
  const connectionTokenPrefix = generateTokenName(
    handlerAuthToken,
    CONNECTION_TOKEN_PREFIX,
    ''
  );
  const channelTokenPrefix = generateTokenName(
    handlerAuthToken,
    CHANNEL_TOKEN_PREFIX,
    ''
  );

  const block = from_explicit_network_cbor_bytes(
    fromHex(cborHex)
  ) as CardanoBlock;
  if (!block.as_babbage()) {
    console.error(`Handling an incoming block error: Block is not babbage`);
    return;
  }

  const babbageBlock = block.as_babbage() as BabbageBlock;
  const blockHeight = babbageBlock.header().header_body().block_number();
  logger.info(`Handling block ${blockHeight} on Cardano starting`);
  const slot = babbageBlock.header().header_body().slot();
  const transactionBodies = babbageBlock.transaction_bodies();
  if (!transactionBodies.len()) {
    logger.info(`Block Height ${blockHeight} hasn't transaction`);
    return;
  }

  const outputs: TxOutput[] = extractTxOutput(transactionBodies);
  for (const txOutput of outputs) {
    const isMatchClientTokenPrefix = hasTokenPrefix(
      txOutput.assets,
      clientTokenPrefix
    );
    logger.info({
      isMatchClientTokenPrefix,
      clientTokenPrefix,
    });

    if (hasTokenPrefix(txOutput.assets, clientTokenPrefix)) {
      logger.info('handle client events');
      const transactionWitnessSets = babbageBlock
        .transaction_witness_sets()
        .get(txOutput.txIndex);
      if (!transactionWitnessSets.redeemers()?.len()) continue;
      const redeemers =
        transactionWitnessSets.redeemers() as AlonzoRedeemerList;

      await handleParseClientEvents(txOutput, redeemers, blockHeight);
    }
    if (hasTokenPrefix(txOutput.assets, connectionTokenPrefix)) {
      logger.info('handle connection events');
      const transactionWitnessSets = babbageBlock
        .transaction_witness_sets()
        .get(txOutput.txIndex);
      if (!transactionWitnessSets.redeemers()?.len()) continue;
      const redeemers =
        transactionWitnessSets.redeemers() as AlonzoRedeemerList;

      await handleParseConnectionEvents(txOutput, redeemers, blockHeight);
    }
    if (hasTokenPrefix(txOutput.assets, channelTokenPrefix)) {
      logger.info('handle channel events');
      const transactionWitnessSets = babbageBlock
        .transaction_witness_sets()
        .get(txOutput.txIndex);
      if (!transactionWitnessSets.redeemers()?.len()) continue;
      const redeemers =
        transactionWitnessSets.redeemers() as AlonzoRedeemerList;

      await handleParseChannelEvents(txOutput, redeemers, blockHeight, slot);
    }
  }
}

async function handleParseClientEvents(
  txOutput: TxOutput,
  redeemers: AlonzoRedeemerList,
  blockHeight: bigint
): Promise<void> {
  try {
    logger.info(`handleParseClientEvents starting`);
    const clientDatum = decodeCborHex(txOutput.datum, ClientDatum);
    const latestConsensus = [...clientDatum.state.consensus_states].at(-1);
    const fstRedeemerData = redeemers.get(0).data();

    let eventType: EventType = EventType.ChannelOpenInit;
    let header = '';
    if (fstRedeemerData.as_constr_plutus_data()?.fields().len() == 0) {
      logger.info('create client');
      // for create client
      // const handlerOperatorRedeemerHex = fstRedeemerData.to_cbor_hex();
      // const handlerOperatorRedeemer = decodeCborHex(handlerOperatorRedeemerHex, HandlerOperator);
      eventType = EventType.CreateClient;
    } else {
      logger.info('update client');
      // for update client
      const spendClientRedeemerHex = redeemers.get(0).data().to_cbor_hex();
      const spendClientRedeemer = decodeCborHex(
        spendClientRedeemerHex,
        SpendClientRedeemer
      );
      eventType = EventType.UpdateClient;

      if (spendClientRedeemer.valueOf().hasOwnProperty('UpdateClient')) {
        // TODO: get header update client

        const UpdateClientSchema = Data.Object({
          UpdateClient: Data.Object({ msg: ClientMessageSchema }),
        });
        type UpdateClientSchema = Data.Static<typeof UpdateClientSchema>;
        const HeaderCaseSchema = Data.Object({
          HeaderCase: Data.Tuple([HeaderSchema]),
        });
        type HeaderCaseSchema = Data.Static<typeof HeaderCaseSchema>;
        const spendClientRedeemerSchema =
          spendClientRedeemer.valueOf() as unknown as UpdateClientSchema;
        const clientMessage = spendClientRedeemerSchema[
          'UpdateClient'
        ].msg.valueOf() as unknown as HeaderCaseSchema;
        if (clientMessage.hasOwnProperty('HeaderCase')) {
          const headerMessage = clientMessage[
            'HeaderCase'
          ].valueOf()[0] as unknown as Header;
          header = encodeCborObj(headerMessage, Header);
        }
      }
    }

    const event = Event.create({
      id: `${txOutput.hash}-${txOutput.txIndex}`,
      blockHeight: blockHeight,
      txHash: txOutput.hash,
      type: eventType,
      eventAttributes: [
        {
          key: EventAttributeClient.AttributeKeyClientID,
          value: getIdFromTokenAssets(
            txOutput.assets,
            handler.handlerAuthToken,
            CLIENT_PREFIX
          ),
        },
        {
          key: EventAttributeClient.AttributeKeyConsensusHeight,
          value: latestConsensus?.[0].revision_height.toString() ?? '',
        },
        {
          key: EventAttributeClient.AttributeKeyHeader,
          value: header,
        },
      ],
    });

    const clientSequence = getIdFromTokenAssets(
      txOutput.assets,
      handler.handlerAuthToken,
      CLIENT_PREFIX
    );
    const clientId = `${CLIENT_ID_PREFIX}-${clientSequence}`;
    const network = await getProjectNetwork();
    const chainId = network.networkMagic;

    const client = Client.create({
      id: `${chainId}_${clientId}`,
      height: blockHeight,
      chainId: chainId,
      clientId: clientId,
      counterpartyChainId: convertHex2String(
        clientDatum.state.client_state.chain_id
      ),
    });
    await client.save();
    await event.save();
    logger.info(`handleParseClientEvents end`);
  } catch (error) {
    logger.info('Handle Parse Client Event ERR: ', error);
  }
}

async function handleParseConnectionEvents(
  txOutput: TxOutput,
  redeemers: AlonzoRedeemerList,
  blockHeight: bigint
): Promise<void> {
  try {
    const connectionDatum = decodeCborHex(txOutput.datum, ConnectionDatum);
    let eventType: EventType = EventType.ConnectionOpenInit;
    let eventAttributes: EventAttribute[] = [];
    // for connection init
    const connectionId = getIdFromTokenAssets(
      txOutput.assets,
      handler.handlerAuthToken,
      CONNECTION_TOKEN_PREFIX
    );
    if (connectionDatum.state.state == 'Init') {
      const mintConnectionRedeemerHex = redeemers.get(1).data().to_cbor_hex();
      const mintConnectionRedeemer = decodeCborHex(
        mintConnectionRedeemerHex,
        MintConnectionRedeemer
      );
      if (mintConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenInit')) {
        eventType = EventType.ConnectionOpenInit;
        logger.info('caseConnOpenInit');
        eventAttributes = extractConnectionEventAttributes(
          connectionDatum,
          connectionId
        );
      }
      if (mintConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenTry')) {
        eventType = EventType.ConnectionOpenTry;
        eventAttributes = extractConnectionEventAttributes(
          connectionDatum,
          connectionId
        );
      }
    }
    // for connection ack
    if (connectionDatum.state.state == 'Open') {
      const spendConnectionRedeemerHex = redeemers.get(0).data().to_cbor_hex();
      const spendConnectionRedeemer = decodeCborHex(
        spendConnectionRedeemerHex,
        SpendConnectionRedeemer
      );

      if (spendConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenAck')) {
        eventType = EventType.ConnectionOpenAck;
        eventAttributes = extractConnectionEventAttributes(
          connectionDatum,
          connectionId
        );
      }
      if (spendConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenConfirm')) {
        eventType = EventType.ConnectionOpenConfirm;
        eventAttributes = extractConnectionEventAttributes(
          connectionDatum,
          connectionId
        );
      }
    }
    await saveConnection(eventType, connectionDatum, eventAttributes);

    const event = Event.create({
      id: `${txOutput.hash}-${txOutput.txIndex}`,
      blockHeight: blockHeight,
      txHash: txOutput.hash,
      type: eventType,
      eventAttributes: eventAttributes,
    });
    await event.save();
  } catch (error) {
    logger.info('Handle Parse Connection Event ERR: ', error);
  }
}

async function handleParseChannelEvents(
  txOutput: TxOutput,
  redeemers: AlonzoRedeemerList,
  blockHeight: bigint,
  slot: bigint
): Promise<void> {
  try {
    // case channel init

    const channelDatum = decodeCborHex(txOutput.datum, ChannelDatum);
    let eventType: EventType = EventType.ChannelOpenInit;
    let eventAttributes: EventAttribute[] = [];
    const currentChannelId = getIdFromTokenAssets(
      txOutput.assets,
      handler.handlerAuthToken,
      CHANNEL_TOKEN_PREFIX
    );
    if (channelDatum.state.channel.state == 'Init') {
      const mintChannelRedeemerHex = redeemers.get(2).data().to_cbor_hex();
      const mintChannelRedeemer = decodeCborHex(
        mintChannelRedeemerHex,
        MintChannelRedeemer
      );
      if (mintChannelRedeemer.valueOf().hasOwnProperty('ChanOpenInit')) {
        eventType = EventType.ChannelOpenInit;
        eventAttributes = extractChannelEventAttributes(
          channelDatum,
          currentChannelId
        );
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (mintChannelRedeemer.valueOf().hasOwnProperty('ChanOpenTry')) {
        eventType = EventType.ChannelOpenTry;
        eventAttributes = extractChannelEventAttributes(
          channelDatum,
          currentChannelId
        );
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
    }
    // channel ack
    if (channelDatum.state.channel.state == 'Open') {
      const spendChannelRedeemerHex = redeemers.get(0).data().to_cbor_hex();
      const spendChannelRedeemer = decodeCborHex(
        spendChannelRedeemerHex,
        SpendChannelRedeemer
      );
      if (spendChannelRedeemer.valueOf().hasOwnProperty('ChanOpenAck')) {
        eventType = EventType.ChannelOpenAck;
        eventAttributes = extractChannelEventAttributes(
          channelDatum,
          currentChannelId
        );
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('ChanOpenConfirm')) {
        eventType = EventType.ChannelOpenConfirm;
        eventAttributes = extractChannelEventAttributes(
          channelDatum,
          currentChannelId
        );
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('ChanCloseConfirm')) {
        eventType = EventType.ChannelCloseConfirm;
        eventAttributes = extractChannelEventAttributes(
          channelDatum,
          currentChannelId
        );
        await saveChannel(eventType, eventAttributes, channelDatum);
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('RecvPacket')) {
        eventType = EventType.RecvPacket;
        eventAttributes = extractPacketEventAttributes(
          channelDatum,
          spendChannelRedeemer
        );
        await saveCardanoIBCAssets(eventType, eventAttributes);
        await saveCardanoTransfers(
          eventType,
          txOutput.hash,
          blockHeight,
          slot,
          eventAttributes
        );
        await savePacket(
          eventType,
          txOutput.hash,
          blockHeight,
          slot,
          eventAttributes
        );
        await saveMessage(
          eventType,
          txOutput.hash,
          txOutput.fee,
          blockHeight,
          slot,
          eventAttributes
        );
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('TimeoutPacket')) {
        eventType = EventType.TimeoutPacket;
        eventAttributes = extractPacketEventAttributes(
          channelDatum,
          spendChannelRedeemer
        );
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('AcknowledgePacket')) {
        eventType = EventType.AcknowledgePacket;
        eventAttributes = extractPacketEventAttributes(
          channelDatum,
          spendChannelRedeemer
        );
        await saveCardanoTransfers(
          eventType,
          txOutput.hash,
          blockHeight,
          slot,
          eventAttributes
        );
        await saveMessage(
          eventType,
          txOutput.hash,
          txOutput.fee,
          blockHeight,
          slot,
          eventAttributes
        );
      }
      if (spendChannelRedeemer.valueOf().hasOwnProperty('SendPacket')) {
        eventType = EventType.SendPacket;
        // const packetData = getPacketData(spendChannelRedeemer)
        eventAttributes = extractPacketEventAttributes(
          channelDatum,
          spendChannelRedeemer
        );
        await saveCardanoTransfers(
          eventType,
          txOutput.hash,
          blockHeight,
          slot,
          eventAttributes
        );
        await savePacket(
          eventType,
          txOutput.hash,
          blockHeight,
          slot,
          eventAttributes
        );
        await saveMessage(
          eventType,
          txOutput.hash,
          txOutput.fee,
          blockHeight,
          slot,
          eventAttributes
        );
      }
      if (eventType == EventType.ChannelOpenInit) return;
    }

    const event = Event.create({
      id: `${txOutput.hash}-${txOutput.txIndex}`,
      blockHeight: blockHeight,
      txHash: txOutput.hash,
      type: eventType,
      eventAttributes: eventAttributes,
    });
    await event.save();
  } catch (error) {
    logger.info('Handle Parse Channel Event ERR: ', error);
  }
}

function extractConnectionEventAttributes(
  connDatum: ConnectionDatum,
  connectionId: string
): EventAttribute[] {
  return [
    {
      key: EventAttributeConnection.AttributeKeyConnectionID,
      value: `${CONNECTION_ID_PREFIX}-${connectionId}`,
    },
    {
      key: EventAttributeConnection.AttributeKeyClientID,
      value: convertHex2String(connDatum.state.client_id),
    },
    {
      key: EventAttributeConnection.AttributeKeyCounterpartyClientID,
      value: convertHex2String(connDatum.state.counterparty.client_id),
    },
    {
      key: EventAttributeConnection.AttributeKeyCounterpartyConnectionID,
      value: convertHex2String(connDatum.state.counterparty.connection_id),
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

function extractChannelEventAttributes(
  channelDatum: ChannelDatum,
  channelId: string
): EventAttribute[] {
  const connectionId = Buffer.from(
    hexToBytes(channelDatum.state.channel.connection_hops[0])
  ).toString();
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
      value: convertHex2String(
        channelDatum.state.channel.counterparty.channel_id
      ),
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

function extractPacketEventAttributes(
  channelDatum: ChannelDatum,
  channelRedeemer: SpendChannelRedeemer
): EventAttribute[] {
  let packetData: PacketSchema;
  let acknowledgement = '';
  if (channelRedeemer.hasOwnProperty('RecvPacket'))
    packetData = channelRedeemer['RecvPacket']?.packet as unknown;
  if (channelRedeemer.hasOwnProperty('SendPacket'))
    packetData = channelRedeemer['SendPacket']?.packet as unknown;
  if (channelRedeemer.hasOwnProperty('AcknowledgePacket')) {
    packetData = channelRedeemer['AcknowledgePacket']?.packet as unknown;
    acknowledgement = channelRedeemer['AcknowledgePacket']?.acknowledgement;
  }
  if (channelRedeemer.hasOwnProperty('TimeoutPacket'))
    packetData = channelRedeemer['TimeoutPacket']?.packet as unknown;
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

async function saveCardanoIBCAssets(
  eventType: EventType,
  eventAttribute: EventAttribute[]
) {
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
        const prefixDenom = convertString2Hex(
          voucherTokenRecvPrefix + denomRecv
        );
        const voucherTokenName = hashSha3_256(prefixDenom);
        const voucherTokenUnit =
          handler.validators.mintVoucher.scriptHash + voucherTokenName;
        const cardanoIbcAsset = await store.get(
          `CardanoIbcAsset`,
          `${voucherTokenUnit}`
        );
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

async function saveChannel(
  eventType: EventType,
  eventAttribute: EventAttribute[],
  channelDatum: ChannelDatum
) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });

  const network = await getProjectNetwork();
  const chainId = network.networkMagic;

  const connectionUnit = `${chainId}_${map.get(
    EventAttributeChannel.AttributeKeyConnectionID
  )}`;
  const connection = await Connection.get(connectionUnit);

  let channel = Channel.create({
    id: `${chainId}_${map.get(
      EventAttributeChannel.AttributeKeyPortID
    )}_${map.get(EventAttributeChannel.AttributeKeyChannelID)}`,
    chainId: chainId,
    portId: map.get(EventAttributeChannel.AttributeKeyPortID),
    channelId: map.get(EventAttributeChannel.AttributeKeyChannelID),
    connectionId: connectionUnit,
    counterpartyPortId: map.get(
      EventAttributeChannel.AttributeCounterpartyPortID
    ),
    counterpartyChannelId: map.get(
      EventAttributeChannel.AttributeCounterpartyChannelID
    ),
    counterpartyChainId: connection?.counterpartyChainId,
  });
  await channel.save();
}

async function saveConnection(
  eventType: EventType,
  connDatum: ConnectionDatum,
  eventAttribute: EventAttribute[]
) {
  let map = new Map<string, string>();

  eventAttribute.forEach((item) => {
    map.set(item.key, item.value);
  });

  const versions = connDatum.state.versions.map((version) => ({
    identifier: convertHex2String(version.identifier),
    features: version.features.map((features) => convertHex2String(features)),
  }));

  const network = await getProjectNetwork();
  const chainId = network.networkMagic;
  const clientUnit = `${chainId}_${map.get(
    EventAttributeConnection.AttributeKeyClientID
  )}`;
  const client = await Client.get(clientUnit);
  let connection = Connection.create({
    id: `${chainId}_${map.get(
      EventAttributeConnection.AttributeKeyConnectionID
    )}`,
    chainId: chainId,
    connectionId: map.get(EventAttributeConnection.AttributeKeyConnectionID),
    clientId: clientUnit,
    counterpartyChainId: client?.counterpartyChainId,
    counterpartyClientId: map.get(
      EventAttributeConnection.AttributeKeyCounterpartyClientID
    ),
    counterpartyConnectionId: map.get(
      EventAttributeConnection.AttributeKeyCounterpartyConnectionID
    ),
  });

  await connection.save();
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

  const prefixDenom = convertString2Hex(
    voucherTokenRecvPrefix + packetDataObject?.denom
  );
  const voucherTokenName = hashSha3_256(prefixDenom);
  const voucherTokenUnit =
    handler.validators.mintVoucher.scriptHash + voucherTokenName;

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

function getPacketData(channelRedeemer: SpendChannelRedeemer): string {
  let packetData: PacketSchema;
  if (channelRedeemer.hasOwnProperty('RecvPacket'))
    packetData = channelRedeemer['RecvPacket']?.packet as unknown;
  if (channelRedeemer.hasOwnProperty('SendPacket'))
    packetData = channelRedeemer['SendPacket']?.packet as unknown;
  if (channelRedeemer.hasOwnProperty('AcknowledgePacket')) {
    packetData = channelRedeemer['AcknowledgePacket']?.packet as unknown;
    acknowledgement = channelRedeemer['AcknowledgePacket']?.acknowledgement;
  }
  if (channelRedeemer.hasOwnProperty('TimeoutPacket'))
    packetData = channelRedeemer['TimeoutPacket']?.packet as unknown;
  return packetData?.data;
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
    const channelUnit = `${srcChainId}_${map.get(
      EventAttributeChannel.AttributeKeyDstPort
    )}_${map.get(EventAttributeChannel.AttributeKeyDstChannel)}`;
    const channel = await Channel.get(channelUnit);

    const dstChainId = channel?.counterpartyChainId;
    const packetId = `${dstChainId}_${map.get(
      EventAttributeChannel.AttributeKeySrcPort
    )}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(
      EventAttributeChannel.AttributeKeySequence
    )}`;

    const packet = await Packet.get(packetId);
    if (!packet) {
      const newPacket = Packet.create({
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
      await newPacket.save();
    }
  } else {
    const channelUnit = `${srcChainId}_${map.get(
      EventAttributeChannel.AttributeKeySrcPort
    )}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}`;
    const channel = await Channel.get(channelUnit);
    const packetId = `${srcChainId}_${map.get(
      EventAttributeChannel.AttributeKeySrcPort
    )}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(
      EventAttributeChannel.AttributeKeySequence
    )}`;

    const newPacket = Packet.create({
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

    await newPacket.save();
  }
}

async function saveMessage(
  eventType: EventType,
  txHash: String,
  blockHeight: BigInt,
  slot: BigInt,
  fee: BigInt,
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
  const time = BigInt(network.systemStart) + BigInt(network.slotLength) * slot;

  if (eventType == MsgType.RecvPacket) {
    const messageId = `${chainId}_${txHash}_0_${eventType}`;
    const channleUnit = `${chainId}_${map.get(
      EventAttributeChannel.AttributeKeyDstPort
    )}_${map.get(EventAttributeChannel.AttributeKeyDstChannel)}`;
    const channel = await Channel.get(channleUnit);
    const counterpartyChainId = channel?.counterpartyChainId;

    const packetUnit = `${counterpartyChainId}_${map.get(
      EventAttributeChannel.AttributeKeySrcPort
    )}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(
      EventAttributeChannel.AttributeKeySequence
    )}`;
    const newMessage = Message.create({
      id: messageId,
      chainId: counterpartyChainId,
      msgIdx: 0,
      txHash: txHash,
      sender: packetDataObject?.sender,
      receiver: packetDataObject?.receiver,
      msgType: eventType,
      packetId: packetUnit,
      gas: fee,
      time: time,
    });
    await newMessage.save();
  } else {
    const messageId = `${chainId}_${txHash}_0_${eventType}`;
    const packetUnit = `${chainId}_${map.get(
      EventAttributeChannel.AttributeKeySrcPort
    )}_${map.get(EventAttributeChannel.AttributeKeySrcChannel)}_${map.get(
      EventAttributeChannel.AttributeKeySequence
    )}`;

    const newMessage = Message.create({
      id: messageId,
      chainId: chainId,
      msgIdx: 0,
      txHash: txHash,
      sender: packetDataObject?.sender,
      receiver: packetDataObject?.receiver,
      msgType: eventType,
      packetId: packetUnit,
      gas: fee,
      time: time,
    });

    await newMessage.save();
  }
}

function getDenomBase(denom: string): string {
  const steps = denom.split('/');
  return steps.pop();
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

// utxo.ts
export class TokenAsset {
  name: string;
  quantity: bigint;
  constructor(name: string, quantity: bigint) {
    this.name = name;
    this.quantity = quantity;
  }
}

export class TxOutput {
  hash: string;
  txIndex: number;
  outputIndex: number;
  address: string;
  datum: string;
  fee: bigint;
  datum_plutus: PlutusData;
  assets: Map<string, TokenAsset[]>;

  constructor(
    hash: string,
    txIndex: number,
    outputIndex: number,
    address: string,
    datum: string,
    fee: bigint,
    datum_plutus: PlutusData,
    assets: Map<string, TokenAsset[]>
  ) {
    this.hash = hash;
    this.txIndex = txIndex;
    this.outputIndex = outputIndex;
    this.address = address;
    this.datum = datum;
    this.fee = fee;
    this.datum_plutus = datum_plutus;
    this.assets = assets;
  }
}
