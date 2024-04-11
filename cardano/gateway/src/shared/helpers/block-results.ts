import { Event, EventAttribute, ResponseDeliverTx } from '@plus/proto-types/build/ibc/core/types/v1/block';
import {
  EVENT_TYPE_CONNECTION,
  ATTRIBUTE_KEY_CONNECTION,
  EVENT_TYPE_CHANNEL,
  ATTRIBUTE_KEY_CHANNEL,
  ATTRIBUTE_KEY_CLIENT,
  CONNECTION_ID_PREFIX,
  CHANNEL_ID_PREFIX,
  CLIENT_ID_PREFIX,
  ATTRIBUTE_KEY_PACKET,
  EVENT_TYPE_PACKET,
} from '../../constant';
import { ChannelDatum } from '../types/channel/channel-datum';
import { ConnectionDatum } from '../types/connection/connection-datum';
import { State as ConnectionState } from '../types/connection/state';
import { ChannelState } from '../types/channel/state';
import { ClientDatum } from '../types/client-datum';
import { convertHex2String, toHex } from './hex';
import { SpendChannelRedeemer } from '../types/channel/channel-redeemer';
import { Packet } from '../types/channel/packet';
import { IBCModuleCallback, IBCModuleRedeemer } from '../types/port/ibc_module_redeemer';
import { Acknowledgement } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { AcknowledgementResponse } from '../types/channel/acknowledgement_response';
import { SpendClientRedeemer } from '../types/client-redeemer';
import { convertHeaderToTendermint } from '../types/header';
import { Header } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { Any } from '@plus/proto-types/build/google/protobuf/any';

export function normalizeEventConnection(evtType: ConnectionState): string {
  switch (evtType) {
    case ConnectionState.Init:
      return EVENT_TYPE_CONNECTION.OPEN_INIT;
    case ConnectionState.TryOpen:
      return EVENT_TYPE_CONNECTION.OPEN_TRY;
    case ConnectionState.Open:
      return EVENT_TYPE_CONNECTION.OPEN_ACK;
    default:
      return '';
  }
}

export function normalizeTxsResultFromConnDatum(connDatum: ConnectionDatum, connectionId: string): ResponseDeliverTx {
  return {
    code: 0,
    events: [
      {
        type: normalizeEventConnection(connDatum.state.state),
        event_attribute: [
          {
            key: ATTRIBUTE_KEY_CONNECTION.CONNECTION_ID,
            value: `${CONNECTION_ID_PREFIX}-${connectionId}`,
          },
          {
            key: ATTRIBUTE_KEY_CONNECTION.CLIENT_ID,
            value: convertHex2String(connDatum.state.client_id),
          },
          {
            key: ATTRIBUTE_KEY_CONNECTION.COUNTERPARTY_CLIENT_ID,
            value: convertHex2String(connDatum.state.counterparty.client_id),
          },
          {
            key: ATTRIBUTE_KEY_CONNECTION.COUNTERPARTY_CONNECTION_ID,
            value: convertHex2String(connDatum.state.counterparty.connection_id),
          },
        ].map(
          (attr) =>
            <EventAttribute>{
              key: attr.key.toString(),
              value: attr.value.toString(),
              index: true,
            },
        ),
      },
    ] as Event[],
  } as unknown as ResponseDeliverTx;
}

export function normalizeEventChannel(evtType: ChannelState): string {
  switch (evtType) {
    case ChannelState.Init:
      return EVENT_TYPE_CHANNEL.OPEN_INIT;
    case ChannelState.TryOpen:
      return EVENT_TYPE_CHANNEL.OPEN_TRY;
    case ChannelState.Open:
      return EVENT_TYPE_CHANNEL.OPEN_ACK;
    case ChannelState.Close:
      return EVENT_TYPE_CHANNEL.CLOSE;
    default:
      return '';
  }
}

export function normalizeTxsResultFromChannelDatum(
  chanDatum: ChannelDatum,
  connectionId: string,
  channelId: string,
): ResponseDeliverTx {
  return {
    code: 0,
    events: [
      {
        type: normalizeEventChannel(chanDatum.state.channel.state),
        event_attribute: [
          {
            key: ATTRIBUTE_KEY_CHANNEL.CONNECTION_ID,
            value: connectionId,
          },
          {
            key: ATTRIBUTE_KEY_CHANNEL.PORT_ID,
            value: convertHex2String(chanDatum.port),
          },
          {
            key: ATTRIBUTE_KEY_CHANNEL.CHANNEL_ID,
            value: `${CHANNEL_ID_PREFIX}-${channelId}`,
          },
          {
            key: ATTRIBUTE_KEY_CHANNEL.VERSION,
            value: convertHex2String(chanDatum.state.channel.version),
          },
          {
            key: ATTRIBUTE_KEY_CHANNEL.COUNTERPARTY_CHANNEL_ID,
            value: convertHex2String(chanDatum.state.channel.counterparty.channel_id),
          },
          {
            key: ATTRIBUTE_KEY_CHANNEL.COUNTERPARTY_PORT_ID,
            value: convertHex2String(chanDatum.state.channel.counterparty.port_id),
          },
        ].map(
          (attr) =>
            <EventAttribute>{
              key: attr.key.toString(),
              value: attr.value.toString(),
              index: true,
            },
        ),
      },
    ] as Event[],
  } as unknown as ResponseDeliverTx;
}

export function normalizeTxsResultFromClientDatum(
  ClientDatum: ClientDatum,
  clientEvent: string,
  clientId: string,
  spendClientRedeemer: SpendClientRedeemer,
): ResponseDeliverTx {
  const [latestHeight] = [...ClientDatum.state.consensusStates].at(-1);
  let header = '';

  if (spendClientRedeemer && spendClientRedeemer.hasOwnProperty('UpdateClient')) {
    const clientMessage = spendClientRedeemer['UpdateClient'].msg;

    if (clientMessage && clientMessage.hasOwnProperty('HeaderCase')) {
      const msgUpdateClient = convertHeaderToTendermint(clientMessage['HeaderCase'][0]);
      const headerAny: Any = {
        type_url: '/ibc.lightclients.tendermint.v1.Header',
        value: Header.encode(msgUpdateClient).finish(),
      };
      header = toHex(Any.encode(headerAny).finish());
    }
  }

  return {
    code: 0,
    events: [
      {
        type: clientEvent,
        event_attribute: [
          {
            key: ATTRIBUTE_KEY_CLIENT.CLIENT_ID,
            value: `${CLIENT_ID_PREFIX}-${clientId}`,
          },
          {
            key: ATTRIBUTE_KEY_CLIENT.CONSENSUS_HEIGHT,
            value: latestHeight.revisionHeight,
          },
          {
            key: ATTRIBUTE_KEY_CLIENT.HEADER,
            value: header,
          },
        ].map(
          (attr) =>
            <EventAttribute>{
              key: attr.key.toString(),
              value: attr.value.toString(),
              index: true,
            },
        ),
      },
    ] as Event[],
  } as unknown as ResponseDeliverTx;
}

function getEventPacketChannel(channelRedeemer: SpendChannelRedeemer): string {
  if (channelRedeemer.hasOwnProperty('RecvPacket')) return EVENT_TYPE_PACKET.RECV_PACKET;
  if (channelRedeemer.hasOwnProperty('SendPacket')) return EVENT_TYPE_PACKET.SEND_PACKET;
  if (channelRedeemer.hasOwnProperty('AcknowledgePacket')) return EVENT_TYPE_PACKET.ACKNOWLEDGE_PACKET;
  if (channelRedeemer.hasOwnProperty('TimeoutPacket')) return EVENT_TYPE_PACKET.TIMEOUT_PACKET;
  return '';
}

export function normalizeTxsResultFromChannelRedeemer(
  channelRedeemer: SpendChannelRedeemer,
  channelDatum: ChannelDatum,
): ResponseDeliverTx {
  let packetData: Packet;
  let acknowledgement = '';
  if (channelRedeemer.hasOwnProperty('RecvPacket'))
    packetData = channelRedeemer['RecvPacket']?.packet as unknown as Packet;
  if (channelRedeemer.hasOwnProperty('SendPacket'))
    packetData = channelRedeemer['SendPacket']?.packet as unknown as Packet;
  if (channelRedeemer.hasOwnProperty('AcknowledgePacket')) {
    packetData = channelRedeemer['AcknowledgePacket']?.packet as unknown as Packet;
    acknowledgement = channelRedeemer['AcknowledgePacket']?.acknowledgement;
  }
  if (channelRedeemer.hasOwnProperty('TimeoutPacket'))
    packetData = channelRedeemer['TimeoutPacket']?.packet as unknown as Packet;

  return {
    code: 0,
    events: [
      {
        type: getEventPacketChannel(channelRedeemer),
        event_attribute: [
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DATA,
            value: convertHex2String(packetData.data),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_ACK,
            value: acknowledgement,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX,
            value: packetData.data,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX,
            value: acknowledgement,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_TIMEOUT_HEIGHT,
            value: `${packetData.timeout_height.revisionNumber}-${packetData.timeout_height.revisionHeight}`,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_TIMEOUT_TIMESTAMP,
            value: packetData.timeout_timestamp,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE,
            value: packetData.sequence,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_SRC_PORT,
            value: convertHex2String(packetData.source_port),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL,
            value: convertHex2String(packetData.source_channel),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DST_PORT,
            value: convertHex2String(packetData.destination_port),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DST_CHANNEL,
            value: convertHex2String(packetData.destination_channel),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_CHANNEL_ORDERING,
            value: channelDatum.state.channel.ordering,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_CONNECTION,
            value: convertHex2String(channelDatum.state.channel.connection_hops[0]),
          },
        ].map(
          (attr) =>
            <EventAttribute>{
              key: attr.key.toString(),
              value: attr.value.toString(),
              index: true,
            },
        ),
      },
    ] as Event[],
  } as unknown as ResponseDeliverTx;
}

export function normalizeTxsResultFromModuleRedeemer(
  moduleRedeemer: IBCModuleRedeemer,
  channelRedeemer: SpendChannelRedeemer,
  channelDatum: ChannelDatum,
): ResponseDeliverTx {
  if (!moduleRedeemer.hasOwnProperty('Callback')) return { code: 0, events: [] };
  const moduleCallback = moduleRedeemer['Callback'][0] as unknown as IBCModuleCallback;

  if (!moduleCallback.hasOwnProperty('OnRecvPacket')) return { code: 0, events: [] };
  const acknowledgementRes: AcknowledgementResponse = moduleCallback['OnRecvPacket']?.acknowledgement
    ?.response as unknown as AcknowledgementResponse;

  const acknowledgement: Acknowledgement = {
    result: Buffer.from(
      acknowledgementRes['AcknowledgementResult'] && acknowledgementRes['AcknowledgementResult']['result'],
    ),
    error: acknowledgementRes['AcknowledgementError'] && acknowledgementRes['AcknowledgementError']['err'],
  };

  // TODO: handle packet ack
  const packetData: Packet = channelRedeemer['RecvPacket']?.packet as unknown as Packet;
  return {
    code: 0,
    events: [
      {
        type: EVENT_TYPE_PACKET.WRITE_ACKNOWLEDGEMENT,
        event_attribute: [
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DATA,
            value: convertHex2String(packetData.data),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_ACK,
            value: Buffer.from([123, 34, 114, 101, 115, 117, 108, 116, 34, 58, 34, 65, 81, 61, 61, 34, 125]),
            // value: packetAckBytes,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DATA_HEX,
            value: packetData.data,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX,
            value: toHex(Buffer.from([123, 34, 114, 101, 115, 117, 108, 116, 34, 58, 34, 65, 81, 61, 61, 34, 125])),
            // value: packetAckHex,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_TIMEOUT_HEIGHT,
            value: `${packetData.timeout_height.revisionNumber}-${packetData.timeout_height.revisionHeight}`,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_TIMEOUT_TIMESTAMP,
            value: packetData.timeout_timestamp,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE,
            value: packetData.sequence,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_SRC_PORT,
            value: convertHex2String(packetData.source_port),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_SRC_CHANNEL,
            value: convertHex2String(packetData.source_channel),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DST_PORT,
            value: convertHex2String(packetData.destination_port),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_DST_CHANNEL,
            value: convertHex2String(packetData.destination_channel),
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_CHANNEL_ORDERING,
            value: channelDatum.state.channel.ordering,
          },
          {
            key: ATTRIBUTE_KEY_PACKET.PACKET_CONNECTION,
            value: convertHex2String(channelDatum.state.channel.connection_hops[0]),
          },
        ].map(
          (attr) =>
            <EventAttribute>{
              key: attr.key.toString(),
              value: attr.value.toString(),
              index: true,
            },
        ),
      },
    ] as Event[],
  } as unknown as ResponseDeliverTx;
}
