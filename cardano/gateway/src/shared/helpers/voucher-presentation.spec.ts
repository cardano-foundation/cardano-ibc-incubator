import { deriveVoucherPresentation } from './voucher-presentation';

describe('deriveVoucherPresentation', () => {
  it('strips micro-prefixes for common base denoms', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-7/uatom', 'uatom'),
    ).toEqual({
      displayName: 'ATOM (IBC)',
      displaySymbol: 'ATOM',
      displayDescription: 'IBC voucher for transfer/channel-7/uatom',
    });
  });

  it('falls back to the last path segment for slash-delimited base denoms', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-3/gamm/pool/1', 'gamm/pool/1'),
    ).toEqual({
      displayName: '1 (IBC)',
      displaySymbol: '1',
      displayDescription: 'IBC voucher for transfer/channel-3/gamm/pool/1',
    });
  });
});
