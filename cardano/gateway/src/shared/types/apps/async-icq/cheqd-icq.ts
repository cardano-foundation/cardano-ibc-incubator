import * as protobuf from 'protobufjs';
import { base64FromBytes } from '@plus/proto-types/build/helpers';
import {
  ASYNC_ICQ_HOST_PORT,
  CosmosResponse,
  TendermintRequestQuery,
  decodeAsyncIcqAcknowledgementHex,
  encodeAsyncIcqPacketDataFromRequests,
} from './async-icq';

const PAGINATION_PROTO = `
syntax = "proto3";
package cosmos.base.query.v1beta1;

message PageRequest {
  bytes key = 1;
  uint64 offset = 2;
  uint64 limit = 3;
  bool count_total = 4;
  bool reverse = 5;
}

message PageResponse {
  bytes next_key = 1;
  uint64 total = 2;
}
`;

const TIMESTAMP_PROTO = `
syntax = "proto3";
package google.protobuf;

message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}
`;

const CHEQD_DID_PROTO = `
syntax = "proto3";
package cheqd.did.v2;

message DidDoc {
  repeated string context = 1;
  string id = 2;
  repeated string controller = 3;
  repeated VerificationMethod verification_method = 4;
  repeated string authentication = 5;
  repeated string assertion_method = 6;
  repeated string capability_invocation = 7;
  repeated string capability_delegation = 8;
  repeated string key_agreement = 9;
  repeated Service service = 10;
  repeated string also_known_as = 11;
}

message VerificationMethod {
  string id = 1;
  string verification_method_type = 2;
  string controller = 3;
  string verification_material = 4;
}

message Service {
  string id = 1;
  string service_type = 2;
  repeated string service_endpoint = 3;
  repeated string recipient_keys = 4;
  repeated string routing_keys = 5;
  repeated string accept = 6;
  uint32 priority = 7;
}

message Metadata {
  google.protobuf.Timestamp created = 1;
  google.protobuf.Timestamp updated = 2;
  bool deactivated = 3;
  string version_id = 4;
  string next_version_id = 5;
  string previous_version_id = 6;
}

message DidDocWithMetadata {
  DidDoc did_doc = 1;
  Metadata metadata = 2;
}

message QueryDidDocRequest {
  string id = 1;
}

message QueryDidDocResponse {
  DidDocWithMetadata value = 1;
}

message QueryDidDocVersionRequest {
  string id = 1;
  string version = 2;
}

message QueryDidDocVersionResponse {
  DidDocWithMetadata value = 1;
}

message QueryAllDidDocVersionsMetadataRequest {
  string id = 1;
  cosmos.base.query.v1beta1.PageRequest pagination = 2;
}

message QueryAllDidDocVersionsMetadataResponse {
  repeated Metadata versions = 1;
  cosmos.base.query.v1beta1.PageResponse pagination = 2;
}
`;

const CHEQD_RESOURCE_PROTO = `
syntax = "proto3";
package cheqd.resource.v2;

message Resource {
  bytes data = 1;
}

message AlternativeUri {
  string uri = 1;
  string description = 2;
}

message Metadata {
  string collection_id = 1;
  string id = 2;
  string name = 3;
  string version = 4;
  string resource_type = 5;
  repeated AlternativeUri also_known_as = 6;
  string media_type = 7;
  google.protobuf.Timestamp created = 8;
  string checksum = 9;
  string previous_version_id = 10;
  string next_version_id = 11;
}

message ResourceWithMetadata {
  Resource resource = 1;
  Metadata metadata = 2;
}

message QueryResourceRequest {
  string collection_id = 1;
  string id = 2;
}

message QueryResourceResponse {
  ResourceWithMetadata resource = 1;
}

message QueryResourceMetadataRequest {
  string collection_id = 1;
  string id = 2;
}

message QueryResourceMetadataResponse {
  Metadata resource = 1;
}

message QueryLatestResourceVersionRequest {
  string collection_id = 1;
  string name = 2;
  string resource_type = 3;
}

message QueryLatestResourceVersionResponse {
  ResourceWithMetadata resource = 1;
}

message QueryLatestResourceVersionMetadataRequest {
  string collection_id = 1;
  string name = 2;
  string resource_type = 3;
}

message QueryLatestResourceVersionMetadataResponse {
  Metadata resource = 1;
}
`;

const CHEQD_QUERY_DEFINITIONS = {
  didDoc: {
    queryPath: '/cheqd.did.v2.Query/DidDoc',
    requestType: 'cheqd.did.v2.QueryDidDocRequest',
    responseType: 'cheqd.did.v2.QueryDidDocResponse',
  },
  didDocVersion: {
    queryPath: '/cheqd.did.v2.Query/DidDocVersion',
    requestType: 'cheqd.did.v2.QueryDidDocVersionRequest',
    responseType: 'cheqd.did.v2.QueryDidDocVersionResponse',
  },
  allDidDocVersionsMetadata: {
    queryPath: '/cheqd.did.v2.Query/AllDidDocVersionsMetadata',
    requestType: 'cheqd.did.v2.QueryAllDidDocVersionsMetadataRequest',
    responseType: 'cheqd.did.v2.QueryAllDidDocVersionsMetadataResponse',
  },
  resource: {
    queryPath: '/cheqd.resource.v2.Query/Resource',
    requestType: 'cheqd.resource.v2.QueryResourceRequest',
    responseType: 'cheqd.resource.v2.QueryResourceResponse',
  },
  resourceMetadata: {
    queryPath: '/cheqd.resource.v2.Query/ResourceMetadata',
    requestType: 'cheqd.resource.v2.QueryResourceMetadataRequest',
    responseType: 'cheqd.resource.v2.QueryResourceMetadataResponse',
  },
  latestResourceVersion: {
    queryPath: '/cheqd.resource.v2.Query/LatestResourceVersion',
    requestType: 'cheqd.resource.v2.QueryLatestResourceVersionRequest',
    responseType: 'cheqd.resource.v2.QueryLatestResourceVersionResponse',
  },
  latestResourceVersionMetadata: {
    queryPath: '/cheqd.resource.v2.Query/LatestResourceVersionMetadata',
    requestType: 'cheqd.resource.v2.QueryLatestResourceVersionMetadataRequest',
    responseType: 'cheqd.resource.v2.QueryLatestResourceVersionMetadataResponse',
  },
} as const;

let cheqdProtoRoot: protobuf.Root | null = null;

type CheqdQueryKey = keyof typeof CHEQD_QUERY_DEFINITIONS;

export type DecodedCheqdIcqAcknowledgement =
  | {
      status: 'error';
      query_path: string;
      source_port: typeof ASYNC_ICQ_HOST_PORT;
      error: string;
    }
  | {
      status: 'success';
      query_path: string;
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
      query_path: string;
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

function getCheqdProtoRoot(): protobuf.Root {
  if (cheqdProtoRoot) {
    return cheqdProtoRoot;
  }

  const root = new protobuf.Root();
  protobuf.parse(PAGINATION_PROTO, root, { keepCase: true });
  protobuf.parse(TIMESTAMP_PROTO, root, { keepCase: true });
  protobuf.parse(CHEQD_DID_PROTO, root, { keepCase: true });
  protobuf.parse(CHEQD_RESOURCE_PROTO, root, { keepCase: true });
  root.resolveAll();

  cheqdProtoRoot = root;
  return root;
}

function getCheqdMessageType(typeName: string): protobuf.Type {
  const messageType = getCheqdProtoRoot().lookupType(typeName);
  if (!(messageType instanceof protobuf.Type)) {
    throw new Error(`cheqd protobuf type ${typeName} not found`);
  }
  return messageType;
}

export function encodeCheqdProtoMessage(typeName: string, payload: Record<string, unknown>): Uint8Array {
  const messageType = getCheqdMessageType(typeName);
  const verificationError = messageType.verify(payload);
  if (verificationError) {
    throw new Error(`invalid ${typeName} payload: ${verificationError}`);
  }
  return messageType.encode(messageType.create(payload)).finish();
}

export function decodeCheqdProtoMessage(typeName: string, bytes: Uint8Array): Record<string, unknown> {
  const messageType = getCheqdMessageType(typeName);
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

function buildSingleRequestPacket(queryKey: CheqdQueryKey, payload: Record<string, unknown>): {
  packetData: Uint8Array;
  queryPath: string;
} {
  const definition = CHEQD_QUERY_DEFINITIONS[queryKey];
  const requestData = encodeCheqdProtoMessage(definition.requestType, payload);
  const request: TendermintRequestQuery = {
    data: requestData,
    path: definition.queryPath,
    height: BigInt(0),
    prove: false,
  };

  return {
    packetData: encodeAsyncIcqPacketDataFromRequests([request]),
    queryPath: definition.queryPath,
  };
}

function decodeSingleResponse(queryKey: CheqdQueryKey, ackHex: string): DecodedCheqdIcqAcknowledgement {
  const definition = CHEQD_QUERY_DEFINITIONS[queryKey];
  const decodedAck = decodeAsyncIcqAcknowledgementHex(ackHex);

  if (decodedAck.kind === 'error') {
    return {
      status: 'error',
      query_path: definition.queryPath,
      source_port: ASYNC_ICQ_HOST_PORT,
      error: decodedAck.error,
    };
  }

  const cosmosResponse: CosmosResponse = decodedAck.cosmosResponse;
  if (cosmosResponse.responses.length !== 1) {
    throw new Error(
      `expected exactly one async-icq response for ${definition.queryPath}, got ${cosmosResponse.responses.length}`,
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
      query_path: definition.queryPath,
      source_port: ASYNC_ICQ_HOST_PORT,
      error: responseQuery.log || responseQuery.info || `remote query failed with code ${responseQuery.code}`,
      response_query: responseMetadata,
    };
  }

  return {
    status: 'success',
    query_path: definition.queryPath,
    source_port: ASYNC_ICQ_HOST_PORT,
    response: decodeCheqdProtoMessage(definition.responseType, responseQuery.value),
    response_query: responseMetadata,
  };
}

export function buildCheqdDidDocPacketData(payload: { id: string }): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('didDoc', payload);
}

export function buildCheqdDidDocVersionPacketData(payload: {
  id: string;
  version: string;
}): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('didDocVersion', payload);
}

export function buildCheqdAllDidDocVersionsMetadataPacketData(payload: {
  id: string;
}): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('allDidDocVersionsMetadata', payload);
}

export function buildCheqdResourcePacketData(payload: {
  collection_id: string;
  id: string;
}): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('resource', payload);
}

export function buildCheqdResourceMetadataPacketData(payload: {
  collection_id: string;
  id: string;
}): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('resourceMetadata', payload);
}

export function buildCheqdLatestResourceVersionPacketData(payload: {
  collection_id: string;
  name: string;
  resource_type: string;
}): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('latestResourceVersion', payload);
}

export function buildCheqdLatestResourceVersionMetadataPacketData(payload: {
  collection_id: string;
  name: string;
  resource_type: string;
}): { packetData: Uint8Array; queryPath: string } {
  return buildSingleRequestPacket('latestResourceVersionMetadata', payload);
}

export function decodeCheqdDidDocAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('didDoc', ackHex);
}

export function decodeCheqdDidDocVersionAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('didDocVersion', ackHex);
}

export function decodeCheqdAllDidDocVersionsMetadataAcknowledgement(
  ackHex: string,
): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('allDidDocVersionsMetadata', ackHex);
}

export function decodeCheqdResourceAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('resource', ackHex);
}

export function decodeCheqdResourceMetadataAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('resourceMetadata', ackHex);
}

export function decodeCheqdLatestResourceVersionAcknowledgement(ackHex: string): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('latestResourceVersion', ackHex);
}

export function decodeCheqdLatestResourceVersionMetadataAcknowledgement(
  ackHex: string,
): DecodedCheqdIcqAcknowledgement {
  return decodeSingleResponse('latestResourceVersionMetadata', ackHex);
}
