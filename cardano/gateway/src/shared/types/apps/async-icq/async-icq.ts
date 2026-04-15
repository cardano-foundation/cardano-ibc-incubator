import { BinaryReader, BinaryWriter } from '@plus/proto-types/build/binary';
import { base64FromBytes, bytesFromBase64 } from '@plus/proto-types/build/helpers';

export const ASYNC_ICQ_HOST_PORT = 'icqhost';
export const ASYNC_ICQ_CHANNEL_VERSION = 'icq-1';

// Keep the host surface intentionally narrow: these are the Cardano IBC queries
// we can already answer through the existing gateway query services.
export const ASYNC_ICQ_ALLOWED_QUERY_PATHS = [
  '/ibc.core.client.v1.Query/ClientState',
  '/ibc.core.client.v1.Query/ConsensusState',
  '/ibc.core.connection.v1.Query/Connection',
  '/ibc.core.channel.v1.Query/Channel',
  '/ibc.core.channel.v1.Query/PacketCommitment',
  '/ibc.core.channel.v1.Query/PacketReceipt',
  '/ibc.core.channel.v1.Query/NextSequenceReceive',
] as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface TendermintRequestQuery {
  data: Uint8Array;
  path: string;
  height: bigint;
  prove: boolean;
}

export interface TendermintResponseQuery {
  code: number;
  log: string;
  info: string;
  index: bigint;
  key: Uint8Array;
  value: Uint8Array;
  height: bigint;
  codespace: string;
}

export interface CosmosQuery {
  requests: TendermintRequestQuery[];
}

export interface CosmosResponse {
  responses: TendermintResponseQuery[];
}

export interface InterchainQueryPacketData {
  data: Uint8Array;
}

export interface InterchainQueryPacketAck {
  data: Uint8Array;
}

export type DecodedAsyncIcqAcknowledgement =
  | {
      kind: 'result';
      cosmosResponse: CosmosResponse;
    }
  | {
      kind: 'error';
      error: string;
    };

function createBaseTendermintRequestQuery(): TendermintRequestQuery {
  return {
    data: new Uint8Array(),
    path: '',
    height: BigInt(0),
    prove: false,
  };
}

function createBaseTendermintResponseQuery(): TendermintResponseQuery {
  return {
    code: 0,
    log: '',
    info: '',
    index: BigInt(0),
    key: new Uint8Array(),
    value: new Uint8Array(),
    height: BigInt(0),
    codespace: '',
  };
}

function createBaseCosmosQuery(): CosmosQuery {
  return { requests: [] };
}

function createBaseCosmosResponse(): CosmosResponse {
  return { responses: [] };
}

// Async-icq packet bytes and ack bytes are wrapped in JSON with a base64 "data"
// field. We validate that outer shape here before decoding the inner protobuf.
function decodeJsonWrapper(bytes: Uint8Array, label: string): { data: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new Error(`invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { data?: unknown }).data !== 'string') {
    throw new Error(`invalid ${label}: missing base64 data field`);
  }

  return parsed as { data: string };
}

export const TendermintRequestQueryCodec = {
  encode(message: TendermintRequestQuery, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.data.length !== 0) {
      writer.uint32(10).bytes(message.data);
    }
    if (message.path !== '') {
      writer.uint32(18).string(message.path);
    }
    if (message.height !== BigInt(0)) {
      writer.uint32(24).int64(message.height);
    }
    if (message.prove) {
      writer.uint32(32).bool(message.prove);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): TendermintRequestQuery {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTendermintRequestQuery();

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.data = reader.bytes();
          break;
        case 2:
          message.path = reader.string();
          break;
        case 3:
          message.height = reader.int64();
          break;
        case 4:
          message.prove = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }

    return message;
  },
};

export const TendermintResponseQueryCodec = {
  encode(message: TendermintResponseQuery, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.code !== 0) {
      writer.uint32(8).uint32(message.code);
    }
    if (message.log !== '') {
      writer.uint32(26).string(message.log);
    }
    if (message.info !== '') {
      writer.uint32(34).string(message.info);
    }
    if (message.index !== BigInt(0)) {
      writer.uint32(40).int64(message.index);
    }
    if (message.key.length !== 0) {
      writer.uint32(50).bytes(message.key);
    }
    if (message.value.length !== 0) {
      writer.uint32(58).bytes(message.value);
    }
    if (message.height !== BigInt(0)) {
      writer.uint32(72).int64(message.height);
    }
    if (message.codespace !== '') {
      writer.uint32(82).string(message.codespace);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): TendermintResponseQuery {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTendermintResponseQuery();

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.code = reader.uint32();
          break;
        case 3:
          message.log = reader.string();
          break;
        case 4:
          message.info = reader.string();
          break;
        case 5:
          message.index = reader.int64();
          break;
        case 6:
          message.key = reader.bytes();
          break;
        case 7:
          message.value = reader.bytes();
          break;
        case 9:
          message.height = reader.int64();
          break;
        case 10:
          message.codespace = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }

    return message;
  },
};

export const CosmosQueryCodec = {
  encode(message: CosmosQuery, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    // CosmosQuery is only a repeated RequestQuery container.
    for (const request of message.requests) {
      TendermintRequestQueryCodec.encode(request, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CosmosQuery {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCosmosQuery();

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.requests.push(TendermintRequestQueryCodec.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }

    return message;
  },
};

export const CosmosResponseCodec = {
  encode(message: CosmosResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    // CosmosResponse mirrors CosmosQuery as a repeated ResponseQuery container.
    for (const response of message.responses) {
      TendermintResponseQueryCodec.encode(response, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CosmosResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCosmosResponse();

    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.responses.push(TendermintResponseQueryCodec.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }

    return message;
  },
};

export function encodeCosmosQuery(message: CosmosQuery): Uint8Array {
  return CosmosQueryCodec.encode(message).finish();
}

export function decodeCosmosQuery(bytes: Uint8Array): CosmosQuery {
  return CosmosQueryCodec.decode(bytes);
}

export function encodeCosmosResponse(message: CosmosResponse): Uint8Array {
  return CosmosResponseCodec.encode(message).finish();
}

export function decodeCosmosResponse(bytes: Uint8Array): CosmosResponse {
  return CosmosResponseCodec.decode(bytes);
}

export function decodeInterchainQueryPacketDataJson(bytes: Uint8Array): InterchainQueryPacketData {
  const parsed = decodeJsonWrapper(bytes, 'async-icq packet data');
  return { data: bytesFromBase64(parsed.data) };
}

export function encodeInterchainQueryPacketDataJson(message: InterchainQueryPacketData): Uint8Array {
  // Preserve the upstream async-icq wire shape exactly: JSON containing base64
  // of the protobuf-encoded CosmosQuery payload.
  return textEncoder.encode(
    JSON.stringify({
      data: base64FromBytes(message.data),
    }),
  );
}

export function decodeInterchainQueryPacketAckJson(bytes: Uint8Array): InterchainQueryPacketAck {
  const parsed = decodeJsonWrapper(bytes, 'async-icq acknowledgement');
  return { data: bytesFromBase64(parsed.data) };
}

export function encodeInterchainQueryPacketAckJson(message: InterchainQueryPacketAck): Uint8Array {
  // Acknowledgements use the same JSON-plus-base64 wrapper as packet data.
  return textEncoder.encode(
    JSON.stringify({
      data: base64FromBytes(message.data),
    }),
  );
}

export function encodeAsyncIcqPacketDataFromRequests(requests: TendermintRequestQuery[]): Uint8Array {
  return encodeInterchainQueryPacketDataJson({
    data: encodeCosmosQuery({ requests }),
  });
}

export function decodeAsyncIcqAcknowledgementBytes(bytes: Uint8Array): DecodedAsyncIcqAcknowledgement {
  let parsed: unknown;

  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new Error(`invalid async-icq acknowledgement JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid async-icq acknowledgement payload');
  }

  const result = (parsed as { result?: unknown }).result;
  if (typeof result === 'string' && result.length > 0) {
    const interchainAck = decodeInterchainQueryPacketAckJson(bytesFromBase64(result));
    return {
      kind: 'result',
      cosmosResponse: decodeCosmosResponse(interchainAck.data),
    };
  }

  const error = (parsed as { error?: unknown }).error;
  if (typeof error === 'string' && error.length > 0) {
    return {
      kind: 'error',
      error,
    };
  }

  throw new Error('invalid async-icq acknowledgement: expected result or error field');
}

export function decodeAsyncIcqAcknowledgementHex(ackHex: string): DecodedAsyncIcqAcknowledgement {
  return decodeAsyncIcqAcknowledgementBytes(Buffer.from(ackHex, 'hex'));
}
