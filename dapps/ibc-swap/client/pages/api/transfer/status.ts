/* eslint-disable no-await-in-loop */
import type { NextApiRequest, NextApiResponse } from 'next';

import { GATEWAY_TX_BUILDER_ENDPOINT } from '@/configs/runtime';
import {
  findRuntimeChain,
  runtimeRouteChainIds,
  type RuntimeChainConfig,
} from '@/configs/runtimeConfig';
import type {
  IbcPacketSummary,
  TransferLifecyclePhase,
  TransferObservedEvent,
  TransferPacketHop,
  TransferStatusResponse,
} from '@/types/transferStatus';

const PACKET_EVENTS = {
  send: 'send_packet',
  recv: 'recv_packet',
  writeAck: 'write_acknowledgement',
  acknowledge: 'acknowledge_packet',
  timeout: 'timeout_packet',
} as const;

type PacketEventType = typeof PACKET_EVENTS[keyof typeof PACKET_EVENTS];

type JsonRecord = Record<string, unknown>;

type CardanoPacketEvent = {
  tx_hash?: string;
  txHash?: string;
  height?: string | number;
  type?: string;
  attributes?: Record<string, unknown>;
  packet?: {
    sequence?: string | number;
    source_port?: string;
    sourcePort?: string;
    source_channel?: string;
    sourceChannel?: string;
    destination_port?: string;
    destinationPort?: string;
    destination_channel?: string;
    destinationChannel?: string;
    data_hex?: string;
    dataHex?: string;
    acknowledgement_hex?: string;
    acknowledgementHex?: string;
  };
};

type CardanoChannelHealthResponse = {
  channel_id?: string;
  status?: 'available' | 'blocked';
  reason?: string | null;
  pending_packet_commitment_count?: string;
  earliest_pending_packet_sequence?: string | null;
  pending_packet_commitment_sequences?: string[];
};

const packetAttrKeys = {
  sequence: 'packet_sequence',
  sourcePort: 'packet_src_port',
  sourceChannel: 'packet_src_channel',
  destinationPort: 'packet_dst_port',
  destinationChannel: 'packet_dst_channel',
  dataHex: 'packet_data_hex',
  acknowledgementHex: 'packet_ack_hex',
} as const;

function getSingleQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function getStringField(
  record: JsonRecord,
  ...keys: string[]
): string | undefined {
  const key = keys.find((candidate) => typeof record[candidate] === 'string');
  return key ? (record[key] as string) : undefined;
}

function getArrayField(record: JsonRecord, ...keys: string[]): unknown[] {
  const key = keys.find((candidate) => Array.isArray(record[candidate]));
  return key ? (record[key] as unknown[]) : [];
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function resolveServerRestEndpoint(
  endpoint: string | undefined,
): string | null {
  if (!endpoint) return null;

  // The Next API runs server-side, so local browser endpoints may need a Docker host alias.
  const internalLoopbackHost =
    process.env.IBC_SWAP_LOCALHOST_INTERNAL_HOST ||
    (GATEWAY_TX_BUILDER_ENDPOINT.includes('host.docker.internal')
      ? 'host.docker.internal'
      : '');
  if (!internalLoopbackHost) return endpoint;

  return endpoint.replace(
    /^http:\/\/(localhost|127\.0\.0\.1)(?=:\d+|\/|$)/,
    `http://${internalLoopbackHost}`,
  );
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Status query failed (${response.status}) for ${url.pathname}${
        body ? `: ${body.slice(0, 300)}` : ''
      }`,
    );
  }

  return (await response.json()) as T;
}

async function fetchJsonOrNull<T>(url: URL): Promise<T | null> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });

  // A missing tx is a normal transient state while chain history indexes catch up.
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (
      response.status === 500 &&
      /not found/i.test(body) &&
      /hash/i.test(body)
    ) {
      return null;
    }
    throw new Error(
      `Status query failed (${response.status}) for ${url.pathname}${
        body ? `: ${body.slice(0, 300)}` : ''
      }`,
    );
  }

  return (await response.json()) as T;
}

function attributeRecordFromArray(attributes: unknown): Record<string, string> {
  if (!Array.isArray(attributes)) return {};

  // Cosmos REST emits event attributes as arrays, unlike the normalized Cardano gateway shape.
  return attributes.reduce((acc: Record<string, string>, attr) => {
    if (typeof attr !== 'object' || attr === null) return acc;
    const { key, value } = attr as JsonRecord;
    if (typeof key !== 'string') return acc;
    acc[key] = value === undefined || value === null ? '' : String(value);
    return acc;
  }, {});
}

function packetFromAttributes(
  attributes: Record<string, string>,
): IbcPacketSummary | null {
  const sequence = attributes[packetAttrKeys.sequence];
  const sourcePort = attributes[packetAttrKeys.sourcePort];
  const sourceChannel = attributes[packetAttrKeys.sourceChannel];
  const destinationPort = attributes[packetAttrKeys.destinationPort];
  const destinationChannel = attributes[packetAttrKeys.destinationChannel];
  const dataHex = attributes[packetAttrKeys.dataHex];

  if (
    !sequence ||
    !sourcePort ||
    !sourceChannel ||
    !destinationPort ||
    !destinationChannel
  ) {
    return null;
  }

  const acknowledgementHex = attributes[packetAttrKeys.acknowledgementHex];
  return {
    sequence,
    sourcePort,
    sourceChannel,
    destinationPort,
    destinationChannel,
    ...(dataHex ? { dataHex } : {}),
    ...(acknowledgementHex ? { acknowledgementHex } : {}),
  };
}

function samePacket(a: IbcPacketSummary, b: IbcPacketSummary): boolean {
  return (
    a.sequence === b.sequence &&
    a.sourcePort === b.sourcePort &&
    a.sourceChannel === b.sourceChannel &&
    a.destinationPort === b.destinationPort &&
    a.destinationChannel === b.destinationChannel
  );
}

function observedEventFromAttributes(params: {
  chainId: string;
  type: string;
  txHash?: string;
  height?: string | number;
  attributes: Record<string, string>;
}): TransferObservedEvent | null {
  const packet = packetFromAttributes(params.attributes);
  if (!packet) return null;

  return {
    chainId: params.chainId,
    type: params.type,
    txHash: params.txHash,
    height: params.height === undefined ? undefined : String(params.height),
    packet,
    acknowledgementHex: packet.acknowledgementHex,
  };
}

function observedEventFromCardano(
  chainId: string,
  event: CardanoPacketEvent,
): TransferObservedEvent | null {
  if (!event.type || !event.packet) return null;

  // Accept both snake_case and camelCase fields to tolerate older gateway responses.
  const { packet } = event;
  const sequence = packet.sequence === undefined ? '' : String(packet.sequence);
  const sourcePort = packet.source_port || packet.sourcePort || '';
  const sourceChannel = packet.source_channel || packet.sourceChannel || '';
  const destinationPort =
    packet.destination_port || packet.destinationPort || '';
  const destinationChannel =
    packet.destination_channel || packet.destinationChannel || '';
  const dataHex = packet.data_hex || packet.dataHex || '';
  if (
    !sequence ||
    !sourcePort ||
    !sourceChannel ||
    !destinationPort ||
    !destinationChannel
  ) {
    return null;
  }

  const acknowledgementHex =
    packet.acknowledgement_hex || packet.acknowledgementHex;

  return {
    chainId,
    type: event.type,
    txHash: event.tx_hash || event.txHash,
    height: event.height === undefined ? undefined : String(event.height),
    packet: {
      sequence,
      sourcePort,
      sourceChannel,
      destinationPort,
      destinationChannel,
      ...(dataHex ? { dataHex } : {}),
      ...(acknowledgementHex ? { acknowledgementHex } : {}),
    },
    acknowledgementHex,
  };
}

function findPacketEvent(
  events: TransferObservedEvent[],
  type: PacketEventType,
  packet?: IbcPacketSummary,
): TransferObservedEvent | null {
  return (
    events.find(
      (event) =>
        event.type === type && (!packet || samePacket(event.packet, packet)),
    ) || null
  );
}

function isCardanoChain(chain: RuntimeChainConfig): boolean {
  return chain.kind === 'cardano';
}

function getRuntimeChainOrThrow(chainId: string): RuntimeChainConfig {
  const chain = findRuntimeChain(chainId);
  if (!chain)
    throw new Error(`Unknown chain id "${chainId}" in transfer route`);
  return chain;
}

async function getCardanoTxPacketEvents(
  chainId: string,
  txHash: string,
): Promise<TransferObservedEvent[] | null> {
  const url = new URL(
    `api/cardano/tx/${encodeURIComponent(txHash)}/packet-events`,
    normalizeBaseUrl(GATEWAY_TX_BUILDER_ENDPOINT),
  );
  const response = await fetchJsonOrNull<{
    events?: CardanoPacketEvent[];
  }>(url);
  if (!response) return null;

  return (response.events || [])
    .map((event) => observedEventFromCardano(chainId, event))
    .filter((event): event is TransferObservedEvent => Boolean(event));
}

async function queryCardanoPacketEvent(
  chainId: string,
  eventType: PacketEventType,
  packet: IbcPacketSummary,
): Promise<TransferObservedEvent | null> {
  // Cardano has no Tendermint tx search, so Gateway exposes packet-keyed lookups.
  const url = new URL(
    'api/cardano/packet-events',
    normalizeBaseUrl(GATEWAY_TX_BUILDER_ENDPOINT),
  );
  url.searchParams.set('source_channel', packet.sourceChannel);
  url.searchParams.set('destination_channel', packet.destinationChannel);
  url.searchParams.set('sequence', packet.sequence);
  url.searchParams.set('event_type', eventType);

  const response = await fetchJson<{
    events?: CardanoPacketEvent[];
  }>(url);
  const events = (response.events || [])
    .map((event) => observedEventFromCardano(chainId, event))
    .filter((event): event is TransferObservedEvent => Boolean(event));

  return findPacketEvent(events, eventType, packet);
}

async function queryCardanoChannelHealth(
  packet: IbcPacketSummary,
): Promise<CardanoChannelHealthResponse | null> {
  const url = new URL(
    `api/cardano/channels/${encodeURIComponent(packet.sourceChannel)}/health`,
    normalizeBaseUrl(GATEWAY_TX_BUILDER_ENDPOINT),
  );
  url.searchParams.set('port_id', packet.sourcePort);

  return fetchJsonOrNull<CardanoChannelHealthResponse>(url);
}

function sequenceToBigInt(sequence: string | null | undefined): bigint | null {
  if (!sequence || !/^\d+$/.test(sequence)) return null;
  return BigInt(sequence);
}

async function queryCardanoOrderedChannelBlockage(
  chain: RuntimeChainConfig,
  packet: IbcPacketSummary,
): Promise<TransferPacketHop['blockedByPriorPackets'] | undefined> {
  if (!isCardanoChain(chain)) return undefined;

  const health = await queryCardanoChannelHealth(packet).catch((error) => {
    console.warn('Unable to query Cardano channel health for transfer status', {
      channelId: packet.sourceChannel,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!health || health.status !== 'blocked') return undefined;

  const currentSequence = sequenceToBigInt(packet.sequence);
  const priorSequences = (health.pending_packet_commitment_sequences || [])
    .filter((sequence) => {
      const parsedSequence = sequenceToBigInt(sequence);
      return (
        parsedSequence !== null &&
        currentSequence !== null &&
        parsedSequence < currentSequence
      );
    })
    .sort((left, right) => {
      const leftSequence = sequenceToBigInt(left);
      const rightSequence = sequenceToBigInt(right);
      if (leftSequence === null || rightSequence === null) return 0;
      return leftSequence === rightSequence
        ? 0
        : leftSequence < rightSequence
          ? -1
          : 1;
    });

  if (priorSequences.length === 0) return undefined;

  return {
    channelId: health.channel_id || packet.sourceChannel,
    pendingPacketCommitmentCount:
      health.pending_packet_commitment_count || priorSequences.length.toString(),
    earliestPendingPacketSequence:
      health.earliest_pending_packet_sequence || priorSequences[0] || null,
    pendingPacketSequencesBeforeCurrent: priorSequences,
    reason:
      health.reason ||
      `Ordered Cardano channel ${packet.sourcePort}/${packet.sourceChannel} is blocked by earlier pending packet(s) ${priorSequences.join(', ')}.`,
  };
}

function cosmosTxEventsFromResponse(
  chainId: string,
  response: JsonRecord,
): TransferObservedEvent[] {
  const txResponse = (response.tx_response || response.txResponse) as
    | JsonRecord
    | undefined;
  if (!txResponse) return [];

  const txHash = getStringField(txResponse, 'txhash', 'txHash');
  const height =
    typeof txResponse.height === 'string' ||
    typeof txResponse.height === 'number'
      ? txResponse.height
      : undefined;
  const events = getArrayField(txResponse, 'events');

  return events
    .map((event) => {
      if (typeof event !== 'object' || event === null) return null;
      const { type } = event as JsonRecord;
      if (typeof type !== 'string') return null;

      return observedEventFromAttributes({
        chainId,
        type,
        txHash,
        height,
        attributes: attributeRecordFromArray((event as JsonRecord).attributes),
      });
    })
    .filter((event): event is TransferObservedEvent => Boolean(event));
}

async function getCosmosTxPacketEvents(
  chain: RuntimeChainConfig,
  txHash: string,
): Promise<TransferObservedEvent[] | null> {
  const restEndpoint = resolveServerRestEndpoint(chain.restEndpoint);
  if (!restEndpoint) return null;

  const url = new URL(
    `cosmos/tx/v1beta1/txs/${encodeURIComponent(txHash)}`,
    normalizeBaseUrl(restEndpoint),
  );
  const response = await fetchJsonOrNull<JsonRecord>(url);
  if (!response) return null;

  return cosmosTxEventsFromResponse(chain.id, response);
}

function cosmosTxResponsesFromSearch(
  chainId: string,
  response: JsonRecord,
): TransferObservedEvent[] {
  const txResponses = getArrayField(response, 'tx_responses', 'txResponses');

  return txResponses.flatMap((txResponse) =>
    cosmosTxEventsFromResponse(chainId, { tx_response: txResponse }),
  );
}

function cosmosPacketEventQuery(
  eventType: PacketEventType,
  packet: IbcPacketSummary,
): string {
  // Cosmos tx search can filter directly on packet attributes for a specific event type.
  return [
    `${eventType}.${packetAttrKeys.sequence}='${packet.sequence}'`,
    `${eventType}.${packetAttrKeys.sourceChannel}='${packet.sourceChannel}'`,
    `${eventType}.${packetAttrKeys.destinationChannel}='${packet.destinationChannel}'`,
  ].join(' AND ');
}

async function queryCosmosPacketEvent(
  chain: RuntimeChainConfig,
  eventType: PacketEventType,
  packet: IbcPacketSummary,
): Promise<TransferObservedEvent | null> {
  const restEndpoint = resolveServerRestEndpoint(chain.restEndpoint);
  if (!restEndpoint) return null;

  const url = new URL('cosmos/tx/v1beta1/txs', normalizeBaseUrl(restEndpoint));
  url.searchParams.set('query', cosmosPacketEventQuery(eventType, packet));
  url.searchParams.set('pagination.limit', '10');
  url.searchParams.set('order_by', 'ORDER_BY_ASC');

  const response = await fetchJson<JsonRecord>(url);
  const events = cosmosTxResponsesFromSearch(chain.id, response);
  return findPacketEvent(events, eventType, packet);
}

async function getTxPacketEvents(
  chain: RuntimeChainConfig,
  txHash: string,
): Promise<TransferObservedEvent[] | null> {
  if (isCardanoChain(chain)) return getCardanoTxPacketEvents(chain.id, txHash);
  return getCosmosTxPacketEvents(chain, txHash);
}

async function queryPacketEvent(
  chain: RuntimeChainConfig,
  eventType: PacketEventType,
  packet: IbcPacketSummary,
): Promise<TransferObservedEvent | null> {
  if (isCardanoChain(chain)) {
    return queryCardanoPacketEvent(chain.id, eventType, packet);
  }
  return queryCosmosPacketEvent(chain, eventType, packet);
}

async function findForwardedSendPacket(
  chain: RuntimeChainConfig,
  txHash: string | undefined,
  incomingPacket: IbcPacketSummary,
): Promise<TransferObservedEvent | null> {
  if (!txHash) return null;

  // PFM emits the next hop's send_packet in the intermediary recv transaction.
  const txEvents = await getTxPacketEvents(chain, txHash);
  if (!txEvents) return null;

  return (
    txEvents.find(
      (event) =>
        event.type === PACKET_EVENTS.send &&
        !samePacket(event.packet, incomingPacket),
    ) || null
  );
}

function phaseMessage(
  status: TransferLifecyclePhase,
  packet: IbcPacketSummary | undefined,
): string {
  switch (status) {
    case 'source_tx_pending':
      return 'Waiting for the source transaction to be indexed by the bridge history service.';
    case 'send_packet_indexed':
      return packet
        ? `IBC send_packet ${packet.sourceChannel}/${packet.sequence} is indexed; waiting for relayer delivery.`
        : 'IBC send_packet is indexed; waiting for relayer delivery.';
    case 'recv_packet_observed':
      return 'Destination recv_packet has been observed; waiting for acknowledgement handling.';
    case 'write_acknowledgement_observed':
      return 'Destination write_acknowledgement has been observed; waiting for acknowledgement relay back to the source chain.';
    case 'acknowledge_packet_observed':
      return 'Source acknowledge_packet has been observed. The IBC transfer lifecycle is complete.';
    case 'timeout_observed':
      return 'A timeout_packet has been observed for this transfer.';
    case 'unsupported':
      return 'Live packet status is not supported for this route.';
    case 'failed':
    default:
      return 'Unable to resolve live packet status for this transfer.';
  }
}

async function buildTransferStatus(params: {
  sourceTxHash: string;
  sourceChainId: string;
  destinationChainId: string;
}): Promise<TransferStatusResponse> {
  const routeChainIds = runtimeRouteChainIds(
    params.sourceChainId,
    params.destinationChainId,
  );
  // Status resolution starts at the wallet tx and follows each packet through the configured route.
  const sourceChain = getRuntimeChainOrThrow(params.sourceChainId);
  const sourceTxEvents = await getTxPacketEvents(
    sourceChain,
    params.sourceTxHash,
  );

  if (!sourceTxEvents) {
    return {
      status: 'source_tx_pending',
      message: phaseMessage('source_tx_pending', undefined),
      sourceTxHash: params.sourceTxHash,
      sourceChainId: params.sourceChainId,
      destinationChainId: params.destinationChainId,
      routeChainIds,
      packets: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const firstSend = findPacketEvent(sourceTxEvents, PACKET_EVENTS.send);
  if (!firstSend) {
    return {
      status: 'failed',
      message:
        'The source transaction is indexed, but no IBC send_packet event was found in it.',
      sourceTxHash: params.sourceTxHash,
      sourceChainId: params.sourceChainId,
      destinationChainId: params.destinationChainId,
      routeChainIds,
      packets: [],
      updatedAt: new Date().toISOString(),
    };
  }

  if (routeChainIds.length < 2) {
    return {
      status: 'unsupported',
      message: phaseMessage('unsupported', firstSend.packet),
      sourceTxHash: params.sourceTxHash,
      sourceChainId: params.sourceChainId,
      destinationChainId: params.destinationChainId,
      routeChainIds,
      packets: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const packets: TransferPacketHop[] = [];
  let status: TransferLifecyclePhase = 'send_packet_indexed';
  let statusMessage: string | undefined;
  let currentSend: TransferObservedEvent | null = firstSend;
  let currentPacket = firstSend.packet;

  // Each loop resolves one route edge and stops at the first unobserved packet milestone.
  for (let index = 0; index < routeChainIds.length - 1; index += 1) {
    const hopSourceChain = getRuntimeChainOrThrow(routeChainIds[index]);
    const hopDestinationChain = getRuntimeChainOrThrow(
      routeChainIds[index + 1],
    );
    const hop: TransferPacketHop = {
      index,
      sourceChainId: hopSourceChain.id,
      destinationChainId: hopDestinationChain.id,
      status: 'sent',
      packet: currentPacket,
      send: currentSend || undefined,
    };

    const timeout = await queryPacketEvent(
      hopSourceChain,
      PACKET_EVENTS.timeout,
      currentPacket,
    );
    if (timeout) {
      hop.timeout = timeout;
      hop.status = 'timed_out';
      packets.push(hop);
      status = 'timeout_observed';
      break;
    }

    const recv = await queryPacketEvent(
      hopDestinationChain,
      PACKET_EVENTS.recv,
      currentPacket,
    );
    if (!recv) {
      const blockage = await queryCardanoOrderedChannelBlockage(
        hopSourceChain,
        currentPacket,
      );
      if (blockage) {
        hop.blockedByPriorPackets = blockage;
        statusMessage = `IBC send_packet ${currentPacket.sourceChannel}/${currentPacket.sequence} is indexed, but the ordered Cardano channel is blocked by earlier pending packet(s) ${blockage.pendingPacketSequencesBeforeCurrent.join(
          ', ',
        )}. The relayer must receive or time out those packet(s) before this packet can reach ${hopDestinationChain.prettyName || hopDestinationChain.id}.`;
      }
      packets.push(hop);
      status = 'send_packet_indexed';
      break;
    }

    hop.recv = recv;
    hop.status = 'received';
    status = 'recv_packet_observed';

    const writeAcknowledgement = await queryPacketEvent(
      hopDestinationChain,
      PACKET_EVENTS.writeAck,
      currentPacket,
    );
    if (writeAcknowledgement) {
      hop.writeAcknowledgement = writeAcknowledgement;
      hop.status = 'acknowledgement_written';
      status = 'write_acknowledgement_observed';
    }

    const acknowledge = await queryPacketEvent(
      hopSourceChain,
      PACKET_EVENTS.acknowledge,
      currentPacket,
    );
    if (acknowledge) {
      hop.acknowledge = acknowledge;
      hop.status = 'acknowledged';
      status = 'acknowledge_packet_observed';
    }

    packets.push(hop);

    if (index >= routeChainIds.length - 2) break;

    const forwardedSend = await findForwardedSendPacket(
      hopDestinationChain,
      recv.txHash,
      currentPacket,
    );
    if (!forwardedSend) break;

    // Multi-hop progress advances only after the intermediary emits a different outbound packet.
    currentSend = forwardedSend;
    currentPacket = forwardedSend.packet;
  }

  return {
    status,
    message: statusMessage || phaseMessage(status, currentPacket),
    sourceTxHash: params.sourceTxHash,
    sourceChainId: params.sourceChainId,
    destinationChainId: params.destinationChainId,
    routeChainIds,
    packets,
    updatedAt: new Date().toISOString(),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Unknown transfer status error.';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TransferStatusResponse>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'failed',
      message: 'Method Not Allowed',
      sourceTxHash: '',
      sourceChainId: '',
      destinationChainId: '',
      routeChainIds: [],
      packets: [],
      updatedAt: new Date().toISOString(),
    });
  }

  const sourceTxHash = getSingleQueryValue(req.query.sourceTxHash).trim();
  const sourceChainId = getSingleQueryValue(req.query.sourceChainId).trim();
  const destinationChainId = getSingleQueryValue(
    req.query.destinationChainId,
  ).trim();

  if (!sourceTxHash || !sourceChainId || !destinationChainId) {
    return res.status(400).json({
      status: 'failed',
      message:
        'sourceTxHash, sourceChainId, and destinationChainId query params are required.',
      sourceTxHash,
      sourceChainId,
      destinationChainId,
      routeChainIds: [],
      packets: [],
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    return res.status(200).json(
      await buildTransferStatus({
        sourceTxHash,
        sourceChainId,
        destinationChainId,
      }),
    );
  } catch (error) {
    return res.status(500).json({
      status: 'failed',
      message: phaseMessage('failed', undefined),
      sourceTxHash,
      sourceChainId,
      destinationChainId,
      routeChainIds: runtimeRouteChainIds(sourceChainId, destinationChainId),
      packets: [],
      updatedAt: new Date().toISOString(),
      error: errorMessage(error),
    });
  }
}
