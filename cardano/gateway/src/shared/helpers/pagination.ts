import { PageRequest } from '@plus/proto-types/build/cosmos/base/query/v1beta1/pagination';
import { PageRequestParams, Params, bytesFromBase64, setPaginationParams } from '@plus/proto-types/build/helpers';
import { PaginationKeyDto } from '../../query/dtos/pagination.dto';

export function generatePaginationKey(key: PaginationKeyDto): Uint8Array {
  return Buffer.from(JSON.stringify(key));
}

export function decodePaginationKey(key: string): string {
  const paginationKey = JSON.parse(Buffer.from(bytesFromBase64(key)).toString()) as unknown as PaginationKeyDto;
  return paginationKey.offset.toString();
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
