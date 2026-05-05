import { deriveVoucherPresentation } from './voucher-presentation';

describe('deriveVoucherPresentation', () => {
  it('uses the base denom for both display name and symbol when it is simple', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-7/uatom', 'uatom'),
    ).toEqual({
      displayName: 'uatom',
      displaySymbol: 'uatom',
      displayDescription: 'IBC voucher for transfer/channel-7/uatom',
    });
  });

  it('keeps slash-delimited base denoms as the display name and uses the final segment as symbol', () => {
    expect(
      deriveVoucherPresentation('transfer/channel-3/gamm/pool/1', 'gamm/pool/1'),
    ).toEqual({
      displayName: 'gamm/pool/1',
      displaySymbol: '1',
      displayDescription: 'IBC voucher for transfer/channel-3/gamm/pool/1',
    });
  });

  it('keeps factory denoms intact as the display name', () => {
    expect(
      deriveVoucherPresentation(
        'transfer/channel-8/factory/osmo1abcd/mytoken',
        'factory/osmo1abcd/mytoken',
      ),
    ).toEqual({
      displayName: 'factory/osmo1abcd/mytoken',
      displaySymbol: 'mytoken',
      displayDescription: 'IBC voucher for transfer/channel-8/factory/osmo1abcd/mytoken',
    });
  });
});
