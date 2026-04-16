import * as protobuf from 'protobufjs';
import { base64FromBytes } from '@plus/proto-types/build/helpers';
import {
  ASYNC_ICQ_HOST_PORT,
  CosmosResponse,
  TendermintRequestQuery,
  decodeAsyncIcqAcknowledgementHex,
  encodeAsyncIcqPacketDataFromRequests,
} from './async-icq';

const VESSELORACLE_PROTO = `
syntax = "proto3";
package vesseloracle.vesseloracle;

message ConsolidatedDataReport {
  string imo = 1;
  uint64 ts = 2;
  int32 total_samples = 3;
  int32 eta_outliers = 4;
  uint64 eta_mean_cleaned = 5;
  uint64 eta_mean_all = 6;
  uint64 eta_std_cleaned = 7;
  uint64 eta_std_all = 8;
  int32 depport_score = 9;
  string depport = 10;
  string creator = 11;
}

message QueryGetConsolidatedDataReportRequest {
  string imo = 1;
  uint64 ts = 2;
}

message QueryGetConsolidatedDataReportResponse {
  ConsolidatedDataReport consolidatedDataReport = 1;
}
`;

export const VESSELORACLE_QUERY_PATH = '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport';
const VESSELORACLE_REQUEST_TYPE = 'vesseloracle.vesseloracle.QueryGetConsolidatedDataReportRequest';
const VESSELORACLE_RESPONSE_TYPE = 'vesseloracle.vesseloracle.QueryGetConsolidatedDataReportResponse';

let vesseloracleProtoRoot: protobuf.Root | null = null;

export type DecodedVesseloracleIcqAcknowledgement =
  | {
      status: 'error';
      query_path: typeof VESSELORACLE_QUERY_PATH;
      source_port: typeof ASYNC_ICQ_HOST_PORT;
      error: string;
    }
  | {
      status: 'success';
      query_path: typeof VESSELORACLE_QUERY_PATH;
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
      query_path: typeof VESSELORACLE_QUERY_PATH;
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

function getVesseloracleProtoRoot(): protobuf.Root {
  if (vesseloracleProtoRoot) {
    return vesseloracleProtoRoot;
  }

  const root = new protobuf.Root();
  protobuf.parse(VESSELORACLE_PROTO, root, { keepCase: true });
  root.resolveAll();
  vesseloracleProtoRoot = root;
  return root;
}

function getVesseloracleMessageType(typeName: string): protobuf.Type {
  const messageType = getVesseloracleProtoRoot().lookupType(typeName);
  if (!(messageType instanceof protobuf.Type)) {
    throw new Error(`vesseloracle protobuf type ${typeName} not found`);
  }

  return messageType;
}

export function encodeVesseloracleProtoMessage(typeName: string, payload: Record<string, unknown>): Uint8Array {
  const messageType = getVesseloracleMessageType(typeName);
  const verificationError = messageType.verify(payload);
  if (verificationError) {
    throw new Error(`invalid ${typeName} payload: ${verificationError}`);
  }

  return messageType.encode(messageType.create(payload)).finish();
}

export function decodeVesseloracleProtoMessage(typeName: string, bytes: Uint8Array): Record<string, unknown> {
  const messageType = getVesseloracleMessageType(typeName);
  const decoded = messageType.decode(bytes);
  return messageType.toObject(decoded, {
    longs: String,
    enums: String,
    bytes: String,
    arrays: true,
    objects: true,
    defaults: false,
  }) as Record<string, unknown>;
}

export function buildVesseloracleConsolidatedDataReportPacketData(payload: {
  imo: string;
  ts: string;
}): { packetData: Uint8Array; queryPath: typeof VESSELORACLE_QUERY_PATH } {
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

export function isSupportedVesseloracleQueryPath(queryPath: string): queryPath is typeof VESSELORACLE_QUERY_PATH {
  return queryPath === VESSELORACLE_QUERY_PATH;
}

export function decodeVesseloracleConsolidatedDataReportAcknowledgement(
  ackHex: string,
): DecodedVesseloracleIcqAcknowledgement {
  const decodedAck = decodeAsyncIcqAcknowledgementHex(ackHex);

  if (decodedAck.kind === 'error') {
    return {
      status: 'error',
      query_path: VESSELORACLE_QUERY_PATH,
      source_port: ASYNC_ICQ_HOST_PORT,
      error: decodedAck.error,
    };
  }

  const cosmosResponse: CosmosResponse = decodedAck.cosmosResponse;
  if (cosmosResponse.responses.length !== 1) {
    throw new Error(
      `expected exactly one async-icq response for ${VESSELORACLE_QUERY_PATH}, got ${cosmosResponse.responses.length}`,
    );
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
      query_path: VESSELORACLE_QUERY_PATH,
      source_port: ASYNC_ICQ_HOST_PORT,
      error: responseQuery.log || responseQuery.info || `remote query failed with code ${responseQuery.code}`,
      response_query: responseMetadata,
    };
  }

  return {
    status: 'success',
    query_path: VESSELORACLE_QUERY_PATH,
    source_port: ASYNC_ICQ_HOST_PORT,
    response: decodeVesseloracleProtoMessage(VESSELORACLE_RESPONSE_TYPE, responseQuery.value),
    response_query: responseMetadata,
  };
}
