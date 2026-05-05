import { Metadata } from '@grpc/grpc-js';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';

export type ProofQueryOptions = {
  queryHeight?: bigint;
};

const QUERY_HEIGHT_METADATA_KEY = 'x-cosmos-block-height';

export function getQueryHeightFromMetadata(metadata?: Metadata): bigint | undefined {
  const values = metadata?.get(QUERY_HEIGHT_METADATA_KEY) ?? [];
  const rawValue = values[0];
  if (rawValue === undefined || rawValue === null) return undefined;

  const value = Buffer.isBuffer(rawValue) ? rawValue.toString('utf8') : rawValue.toString();
  if (value.trim() === '') return undefined;

  if (!/^\d+$/.test(value)) {
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "${QUERY_HEIGHT_METADATA_KEY}" must be a non-negative integer`,
    );
  }

  const height = BigInt(value);
  return height === 0n ? undefined : height;
}
