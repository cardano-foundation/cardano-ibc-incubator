import { deriveVoucherPresentation } from './voucher-presentation';

describe('deriveVoucherPresentation', () => {
  it('uses the full denom as the display name and a one-segment base denom as the symbol', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-7/uatom', 'uatom'),
    ).toEqual({
      displayName: 'transfer/channel-7/uatom',
      displaySymbol: 'uatom',
      displayDescription: 'IBC voucher for transfer/channel-7/uatom',
    });
  });

  it('uses the full denom as the display name and the final base-denom segment as the symbol', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-3/gamm/pool/1', 'gamm/pool/1'),
    ).toEqual({
      displayName: 'transfer/channel-3/gamm/pool/1',
      displaySymbol: '1',
      displayDescription: 'IBC voucher for transfer/channel-3/gamm/pool/1',
    });
  });

  it('uses the full factory denom trace as the display name and the token segment as the symbol', () => {
    expect(
      deriveVoucherPresentation(
        'transfer/channel-8/factory/osmo1abcd/mytoken',
        'factory/osmo1abcd/mytoken',
      ),
    ).toEqual({
      displayName: 'transfer/channel-8/factory/osmo1abcd/mytoken',
      displaySymbol: 'mytoken',
      displayDescription: 'IBC voucher for transfer/channel-8/factory/osmo1abcd/mytoken',
    });
  });
});
