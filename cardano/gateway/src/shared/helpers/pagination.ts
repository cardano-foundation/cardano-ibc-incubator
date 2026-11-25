import { PageRequest, PageResponse } from '@cardano-ibc/proto-types/build/cosmos/base/query/v1beta1/pagination';
import {
  PageRequestParams,
  Params,
  bytesFromBase64,
  setPaginationParams,
} from '@cardano-ibc/proto-types/build/helpers';
import { GrpcInternalException, GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { PaginationKeyDto } from '../../query/dtos/pagination.dto';

const DEFAULT_PAGE_LIMIT = 100n;

export function generatePaginationKey(key: PaginationKeyDto): Uint8Array {
  return Buffer.from(JSON.stringify(key));
}

export function decodePaginationKey(key: string): string {
  const paginationKey = JSON.parse(Buffer.from(bytesFromBase64(key)).toString()) as unknown as PaginationKeyDto;
  return paginationKey.offset.toString();
}

/**
 * Pages an in-memory collection with Cosmos SDK PageRequest semantics.
 *
 * Items are ordered by `sortKey` in UTF-8 byte order, so the key must be unique
 * per item. `next_key` names the first record of the following page, which keeps
 * continuations aligned when earlier records disappear between requests. Keys in
 * the former `{"offset":N}` format are still accepted so clients paging across a
 * deploy keep working.
 */
export function paginate<T>(
  items: T[],
  sortKey: (item: T) => string,
  request?: Partial<PageRequest>,
  options: { maxLimit?: bigint } = {},
): { items: T[]; pagination: PageResponse } {
  const key = request?.key ?? new Uint8Array();
  const offset = BigInt(request?.offset ?? 0);
  if (key.length > 0 && offset > 0n) {
    throw new GrpcInvalidArgumentException('invalid request, either offset or key is expected, got both');
  }
  let limit = BigInt(request?.limit ?? 0);
  if (limit <= 0n) limit = DEFAULT_PAGE_LIMIT;
  if (options.maxLimit !== undefined && limit > options.maxLimit) limit = options.maxLimit;
  const direction = request?.reverse ? -1 : 1;

  const ordered = items
    .map((item) => {
      const sortValue = sortKey(item);
      return { item, sortValue, sortBytes: Buffer.from(sortValue) };
    })
    .sort((left, right) => direction * Buffer.compare(left.sortBytes, right.sortBytes));
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].sortBytes.equals(ordered[index - 1].sortBytes)) {
      throw new GrpcInternalException(`Duplicate pagination key ${ordered[index].sortValue}`);
    }
  }

  let start = offset < BigInt(ordered.length) ? Number(offset) : ordered.length;
  if (key.length > 0) {
    const pageKey = decodePageKey(key);
    if ('offset' in pageKey) {
      start = Math.min(pageKey.offset, ordered.length);
    } else {
      const cursor = Buffer.from(pageKey.next);
      const index = ordered.findIndex(({ sortBytes }) => direction * Buffer.compare(sortBytes, cursor) >= 0);
      start = index < 0 ? ordered.length : index;
    }
  }
  const end = limit < BigInt(ordered.length - start) ? start + Number(limit) : ordered.length;

  return {
    items: ordered.slice(start, end).map(({ item }) => item),
    pagination: {
      next_key: end < ordered.length ? Buffer.from(JSON.stringify({ next: ordered[end].sortValue })) : new Uint8Array(),
      total: request?.count_total ? BigInt(ordered.length) : 0n,
    },
  };
}

function decodePageKey(key: Uint8Array): { next: string } | { offset: number } {
  try {
    const decoded = JSON.parse(Buffer.from(key).toString('utf8'));
    if (typeof decoded?.next === 'string') return { next: decoded.next };
    if (Number.isSafeInteger(decoded?.offset) && decoded.offset >= 0) return { offset: decoded.offset };
  } catch {
    // Reported as an invalid argument below.
  }
  throw new GrpcInvalidArgumentException('invalid request, malformed pagination key');
}

export function getPaginationParams(pagination: PageRequest): PageRequestParams {
  const initialParams: Params = {
    params: {
      'pagination.key': '',
      'pagination.offset': '',
      'pagination.limit': '',
      'pagination.count_total': false,
      'pagination.reverse': true,
    },
  };
  const params = setPaginationParams(initialParams, {
    key: pagination.key,
    offset: pagination.offset,
    limit: pagination.limit,
    countTotal: pagination.count_total,
    reverse: pagination.reverse,
  });

  return params.params;
}
