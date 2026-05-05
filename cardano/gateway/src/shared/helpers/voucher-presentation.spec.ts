import { deriveVoucherPresentation } from './voucher-presentation';

describe('deriveVoucherPresentation', () => {
  it('uses the full denom as the display name and the base denom as symbol when the base denom is simple', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-7/uatom', 'uatom'),
    ).toEqual({
      displayName: 'transfer/channel-7/uatom',
      displaySymbol: 'uatom',
      displayDescription: 'IBC voucher for transfer/channel-7/uatom',
    });
  });

  it('keeps the whole trace as the display name and uses the final base-denom segment as symbol', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-3/gamm/pool/1', 'gamm/pool/1'),
    ).toEqual({
      displayName: 'transfer/channel-3/gamm/pool/1',
      displaySymbol: '1',
      displayDescription: 'IBC voucher for transfer/channel-3/gamm/pool/1',
    });
  });

  it('keeps factory denom traces intact as the display name', () => {
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
