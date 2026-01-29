import { PageRequest } from '@plus/proto-types/build/cosmos/base/query/v1beta1/pagination';

/**
 * Normalize pagination parameters.
 *
 * Cosmos SDK treats pagination as optional; missing/zero limits are replaced by a
 * chain-defined default. Hermes relies on this behavior and often omits the
 * pagination field entirely for list queries.
 */
export function validPagination(pagination?: PageRequest): PageRequest {
  const DEFAULT_LIMIT = BigInt(100);

  const normalized: PageRequest = pagination ?? {
    key: new Uint8Array(),
    offset: BigInt(0),
    limit: DEFAULT_LIMIT,
    count_total: false,
    reverse: false,
  };

  return {
    ...normalized,
    limit: normalized.limit > BigInt(0) ? normalized.limit : DEFAULT_LIMIT,
  };
}
