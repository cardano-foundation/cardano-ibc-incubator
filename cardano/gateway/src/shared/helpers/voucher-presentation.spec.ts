import { deriveVoucherPresentation } from './voucher-presentation';

describe('deriveVoucherPresentation', () => {
  it('uses the final base-denom segment for both display name and symbol', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-7/uatom', 'uatom'),
    ).toEqual({
      displayName: 'uatom',
      displaySymbol: 'uatom',
      displayDescription: 'IBC voucher for transfer/channel-7/uatom',
    });
  });

  it('falls back to the last path segment for slash-delimited base denoms', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-3/gamm/pool/1', 'gamm/pool/1'),
    ).toEqual({
      displayName: '1',
      displaySymbol: '1',
      displayDescription: 'IBC voucher for transfer/channel-3/gamm/pool/1',
    });
  });
});
