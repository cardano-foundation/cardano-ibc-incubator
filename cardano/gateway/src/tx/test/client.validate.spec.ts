import { Height } from '@shared/types/height';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { validateUpdateHeaderAdvancesLatestHeight } from '../helper/client.validate';

describe('update client header height validation', () => {
  const latestHeight: Height = {
    revisionNumber: 0n,
    revisionHeight: 100n,
  };

  it('accepts a header above the latest client height', () => {
    expect(() => validateUpdateHeaderAdvancesLatestHeight(101n, latestHeight)).not.toThrow();
  });

  it('rejects a header at the latest client height', () => {
    expect(() => validateUpdateHeaderAdvancesLatestHeight(100n, latestHeight)).toThrow(GrpcInvalidArgumentException);
  });

  it('rejects a historical header below the latest client height', () => {
    expect(() => validateUpdateHeaderAdvancesLatestHeight(99n, latestHeight)).toThrow(
      'must be greater than client latest height',
    );
  });
});
