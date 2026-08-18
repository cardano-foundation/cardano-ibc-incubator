import { base64FromBytes } from '@cardano-ibc/proto-types/build/helpers';
import {
  QueryGetConsolidatedDataReportRequest,
  QueryGetConsolidatedDataReportResponse,
  QueryLatestConsolidatedDataReportRequest,
  QueryLatestConsolidatedDataReportResponse,
} from '@cardano-ibc/proto-types/build/vesseloracle/vesseloracle/query';
import {
  ASYNC_ICQ_HOST_PORT,
  CosmosResponse,
  TendermintRequestQuery,
  decodeAsyncIcqAcknowledgementHex,
  encodeAsyncIcqPacketDataFromRequests,
} from './async-icq';

// This adapter is intentionally preserved without active API wiring. It keeps
// the VesselOracle async-ICQ wire contract reusable if a target chain hosts the
// corresponding gRPC query service again.

export const VESSELORACLE_QUERY_PATH = '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport';
export const VESSELORACLE_LATEST_QUERY_PATH = '/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport';
const VESSELORACLE_REQUEST_TYPE = 'vesseloracle.vesseloracle.QueryGetConsolidatedDataReportRequest';
const VESSELORACLE_RESPONSE_TYPE = 'vesseloracle.vesseloracle.QueryGetConsolidatedDataReportResponse';
const VESSELORACLE_LATEST_REQUEST_TYPE = 'vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportRequest';
const VESSELORACLE_LATEST_RESPONSE_TYPE = 'vesseloracle.vesseloracle.QueryLatestConsolidatedDataReportResponse';

type SupportedVesseloracleQueryPath = typeof VESSELORACLE_QUERY_PATH | typeof VESSELORACLE_LATEST_QUERY_PATH;

type VesseloracleProtoCodec = {
  encode(payload: Record<string, unknown>): Uint8Array;
  decode(bytes: Uint8Array): Record<string, unknown>;
};

const VESSELORACLE_PROTO_TYPES: Record<string, VesseloracleProtoCodec> = {
  [VESSELORACLE_REQUEST_TYPE]: {
    encode: (payload) =>
      QueryGetConsolidatedDataReportRequest.encode(QueryGetConsolidatedDataReportRequest.fromJSON(payload)).finish(),
    decode: (bytes) =>
      QueryGetConsolidatedDataReportRequest.toJSON(QueryGetConsolidatedDataReportRequest.decode(bytes)) as Record<
        string,
        unknown
      >,
  },
  [VESSELORACLE_RESPONSE_TYPE]: {
    encode: (payload) =>
      QueryGetConsolidatedDataReportResponse.encode(QueryGetConsolidatedDataReportResponse.fromJSON(payload)).finish(),
    decode: (bytes) =>
      QueryGetConsolidatedDataReportResponse.toJSON(QueryGetConsolidatedDataReportResponse.decode(bytes)) as Record<
        string,
        unknown
      >,
  },
  [VESSELORACLE_LATEST_REQUEST_TYPE]: {
    encode: (payload) =>
      QueryLatestConsolidatedDataReportRequest.encode(
        QueryLatestConsolidatedDataReportRequest.fromJSON(payload),
      ).finish(),
    decode: (bytes) =>
      QueryLatestConsolidatedDataReportRequest.toJSON(QueryLatestConsolidatedDataReportRequest.decode(bytes)) as Record<
        string,
        unknown
      >,
  },
  [VESSELORACLE_LATEST_RESPONSE_TYPE]: {
    encode: (payload) =>
      QueryLatestConsolidatedDataReportResponse.encode(
        QueryLatestConsolidatedDataReportResponse.fromJSON(payload),
      ).finish(),
    decode: (bytes) =>
      QueryLatestConsolidatedDataReportResponse.toJSON(
        QueryLatestConsolidatedDataReportResponse.decode(bytes),
      ) as Record<string, unknown>,
  },
};

export type DecodedVesseloracleIcqAcknowledgement =
  | {
      status: 'error';
      query_path: SupportedVesseloracleQueryPath;
      source_port: typeof ASYNC_ICQ_HOST_PORT;
      error: string;
    }
  | {
      status: 'success';
      query_path: SupportedVesseloracleQueryPath;
      source_port: typeof ASYNC_ICQ_HOST_PORT;
      response: Record<string, unknown>;
      response_query: {
        code: number;
        log: string;
        info: string;
        index: string;
        height: string;
        codespace: string;
        raw_value_base64: string;
      };
    }
  | {
      status: 'query_error';
      query_path: SupportedVesseloracleQueryPath;
      source_port: typeof ASYNC_ICQ_HOST_PORT;
      error: string;
      response_query: {
        code: number;
        log: string;
        info: string;
        index: string;
        height: string;
        codespace: string;
        raw_value_base64: string;
      };
    };

function getVesseloracleMessageType(typeName: string): VesseloracleProtoCodec {
  const messageType = VESSELORACLE_PROTO_TYPES[typeName];
  if (!messageType) {
    throw new Error(`vesseloracle protobuf type ${typeName} not found`);
  }

  return messageType;
}

export function encodeVesseloracleProtoMessage(typeName: string, payload: Record<string, unknown>): Uint8Array {
  const messageType = getVesseloracleMessageType(typeName);
  return messageType.encode(payload);
}

export function decodeVesseloracleProtoMessage(typeName: string, bytes: Uint8Array): Record<string, unknown> {
  const messageType = getVesseloracleMessageType(typeName);
  return messageType.decode(bytes);
}

export function buildVesseloracleConsolidatedDataReportPacketData(payload: { imo: string; ts: string }): {
  packetData: Uint8Array;
  queryPath: typeof VESSELORACLE_QUERY_PATH;
} {
  const requestData = encodeVesseloracleProtoMessage(VESSELORACLE_REQUEST_TYPE, {
    imo: payload.imo,
    ts: Number(payload.ts),
  });
  const request: TendermintRequestQuery = {
    data: requestData,
    path: VESSELORACLE_QUERY_PATH,
    height: BigInt(0),
    prove: false,
  };

  return {
    packetData: encodeAsyncIcqPacketDataFromRequests([request]),
    queryPath: VESSELORACLE_QUERY_PATH,
  };
}

export function buildVesseloracleLatestConsolidatedDataReportPacketData(payload: { imo: string }): {
  packetData: Uint8Array;
  queryPath: typeof VESSELORACLE_LATEST_QUERY_PATH;
} {
  const requestData = encodeVesseloracleProtoMessage(VESSELORACLE_LATEST_REQUEST_TYPE, {
    imo: payload.imo,
  });
  const request: TendermintRequestQuery = {
    data: requestData,
    path: VESSELORACLE_LATEST_QUERY_PATH,
    height: BigInt(0),
    prove: false,
  };

  return {
    packetData: encodeAsyncIcqPacketDataFromRequests([request]),
    queryPath: VESSELORACLE_LATEST_QUERY_PATH,
  };
}

export function isSupportedVesseloracleQueryPath(queryPath: string): queryPath is SupportedVesseloracleQueryPath {
  return queryPath === VESSELORACLE_QUERY_PATH || queryPath === VESSELORACLE_LATEST_QUERY_PATH;
}

function responseTypeForVesseloracleQueryPath(queryPath: SupportedVesseloracleQueryPath): string {
  return queryPath === VESSELORACLE_LATEST_QUERY_PATH ? VESSELORACLE_LATEST_RESPONSE_TYPE : VESSELORACLE_RESPONSE_TYPE;
}

function decodeVesseloracleAcknowledgementForPath(
  ackHex: string,
  queryPath: SupportedVesseloracleQueryPath,
): DecodedVesseloracleIcqAcknowledgement {
  const decodedAck = decodeAsyncIcqAcknowledgementHex(ackHex);

  if (decodedAck.kind === 'error') {
    return {
      status: 'error',
      query_path: queryPath,
      source_port: ASYNC_ICQ_HOST_PORT,
      error: decodedAck.error,
    };
  }

  const cosmosResponse: CosmosResponse = decodedAck.cosmosResponse;
  if (cosmosResponse.responses.length !== 1) {
    throw new Error(`expected exactly one async-icq response for ${queryPath}, got ${cosmosResponse.responses.length}`);
  }

  const responseQuery = cosmosResponse.responses[0];
  const responseMetadata = {
    code: responseQuery.code,
    log: responseQuery.log,
    info: responseQuery.info,
    index: responseQuery.index.toString(),
    height: responseQuery.height.toString(),
    codespace: responseQuery.codespace,
    raw_value_base64: base64FromBytes(responseQuery.value),
  };

  if (responseQuery.code !== 0) {
    return {
      status: 'query_error',
      query_path: queryPath,
      source_port: ASYNC_ICQ_HOST_PORT,
      error: responseQuery.log || responseQuery.info || `remote query failed with code ${responseQuery.code}`,
      response_query: responseMetadata,
    };
  }

  return {
    status: 'success',
    query_path: queryPath,
    source_port: ASYNC_ICQ_HOST_PORT,
    response: decodeVesseloracleProtoMessage(responseTypeForVesseloracleQueryPath(queryPath), responseQuery.value),
    response_query: responseMetadata,
  };
}

export function decodeVesseloracleConsolidatedDataReportAcknowledgement(
  ackHex: string,
): DecodedVesseloracleIcqAcknowledgement {
  return decodeVesseloracleAcknowledgementForPath(ackHex, VESSELORACLE_QUERY_PATH);
}

export function decodeVesseloracleLatestConsolidatedDataReportAcknowledgement(
  ackHex: string,
): DecodedVesseloracleIcqAcknowledgement {
  return decodeVesseloracleAcknowledgementForPath(ackHex, VESSELORACLE_LATEST_QUERY_PATH);
}
