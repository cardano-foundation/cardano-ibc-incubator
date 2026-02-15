import { splitFullDenomTrace } from './denom-trace';

describe('splitFullDenomTrace', () => {
  it('splits a single-hop ICS-20 trace', () => {
    expect(splitFullDenomTrace('transfer/channel-7/uatom')).toEqual({
      path: 'transfer/channel-7',
      baseDenom: 'uatom',
    });
  });

  it('keeps slash-containing base denoms intact for single-hop traces', () => {
    expect(splitFullDenomTrace('transfer/channel-7/gamm/pool/1')).toEqual({
      path: 'transfer/channel-7',
      baseDenom: 'gamm/pool/1',
    });
  });

  it('keeps slash-containing base denoms intact for multi-hop traces', () => {
    expect(splitFullDenomTrace('transfer/channel-1/transfer/channel-3/factory/osmo1abcd/mytoken')).toEqual({
      path: 'transfer/channel-1/transfer/channel-3',
      baseDenom: 'factory/osmo1abcd/mytoken',
    });
  });

  it('treats non-trace denoms as base denoms', () => {
    expect(splitFullDenomTrace('factory/osmo1abcd/mytoken')).toEqual({
      path: '',
      baseDenom: 'factory/osmo1abcd/mytoken',
    });
  });

  it('rejects malformed traces with empty segments', () => {
    expect(() => splitFullDenomTrace('transfer/channel-9/')).toThrow('empty path segments');
  });
});
