// @ts-nocheck
import { CosmosMessage } from "@subql/types-cosmos";
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenConfirm,
} from "../types/proto-interfaces/ibc/core/connection/v1/tx";
import {
  AlonzoRedeemerList,
  MultiEraBlock as CardanoBlock,
} from '@dcspark/cardano-multiplatform-multiera-lib-nodejs';
import * as handler from '../contracts/handler.json';
import {
  CONNECTION_TOKEN_PREFIX,
  CONNECTION_ID_PREFIX,
} from '../constants';
import { ConnectionDatum } from "../ibc-types/core/ics_003_connection_semantics/connection_datum/ConnectionDatum";
import {MintConnectionRedeemer} from '../ibc-types/core/ics_003_connection_semantics/connection_redeemer/MintConnectionRedeemer';
import {SpendConnectionRedeemer} from '../ibc-types/core/ics_003_connection_semantics/connection_redeemer/SpendConnectionRedeemer';
import {
  Event,
  Client,
  EventAttribute,
  EventType,
  Connection,
} from '../types';
import { EventAttributeConnection} from '../constants/eventAttributes';
import {convertHex2String} from '../utils/hex';
import { TxOutput } from "./cardanoObject";

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

export async function handleParseCardanoConnectionEvents(
  txOutput: TxOutput,
  redeemers: AlonzoRedeemerList,
  blockHeight: bigint
): Promise<void> {
  try {
    const connectionDatum = decodeCborHex(txOutput.datum, ConnectionDatum);
    let eventType: EventType = EventType.ConnectionOpenInit;
    let eventAttributes: EventAttribute[] = [];
    // for connection init
    const connectionId = getIdFromTokenAssets(txOutput.assets, handler.handlerAuthToken, CONNECTION_TOKEN_PREFIX);
    const txHash = txOutput.hash.toUpperCase();
    if (connectionDatum.state.state == 'Init') {
      const mintConnectionRedeemerHex = redeemers.get(1).data().to_cbor_hex();
      const mintConnectionRedeemer = decodeCborHex(mintConnectionRedeemerHex, MintConnectionRedeemer);
      if (mintConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenInit')) {
        eventType = EventType.ConnectionOpenInit;
        logger.info('caseConnOpenInit');
        eventAttributes = extractCardanoConnectionEventAttributes(connectionDatum, connectionId);
      }
      if (mintConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenTry')) {
        eventType = EventType.ConnectionOpenTry;
        eventAttributes = extractCardanoConnectionEventAttributes(connectionDatum, connectionId);
      }
    }
    // for connection ack
    if (connectionDatum.state.state == 'Open') {
      const spendConnectionRedeemerHex = redeemers.get(0).data().to_cbor_hex();
      const spendConnectionRedeemer = decodeCborHex(spendConnectionRedeemerHex, SpendConnectionRedeemer);

      if (spendConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenAck')) {
        eventType = EventType.ConnectionOpenAck;
        eventAttributes = extractCardanoConnectionEventAttributes(connectionDatum, connectionId);
      }
      if (spendConnectionRedeemer.valueOf().hasOwnProperty('ConnOpenConfirm')) {
        eventType = EventType.ConnectionOpenConfirm;
        eventAttributes = extractCardanoConnectionEventAttributes(connectionDatum, connectionId);
      }
    }
    await saveCardanoConnection(eventType, connectionDatum, eventAttributes);

    const event = Event.create({
      id: `${txHash}-${txOutput.txIndex}`,
      blockHeight: blockHeight,
      txHash: txHash,
      type: eventType,
      eventAttributes: eventAttributes,
    });
    await event.save();
  } catch (error) {
    logger.info('Handle Parse Connection Event ERR: ', error);
  }
}

function extractCardanoConnectionEventAttributes(connDatum: ConnectionDatum, connectionId: string): EventAttribute[] {
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

async function saveCardanoConnection(eventType: EventType, connDatum: ConnectionDatum, eventAttribute: EventAttribute[]) {
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
  const clientUnit = `${chainId}_${map.get(EventAttributeConnection.AttributeKeyClientID)}`;
  const client = await Client.get(clientUnit);
  let connection = Connection.create({
    id: `${chainId}_${map.get(EventAttributeConnection.AttributeKeyConnectionID)}`,
    chainId: chainId,
    connectionId: map.get(EventAttributeConnection.AttributeKeyConnectionID),
    clientId: clientUnit,
    counterpartyChainId: client?.counterpartyChainId,
    counterpartyClientId: map.get(EventAttributeConnection.AttributeKeyCounterpartyClientID),
    counterpartyConnectionId: map.get(EventAttributeConnection.AttributeKeyCounterpartyConnectionID),
  });

  await connection.save();
}