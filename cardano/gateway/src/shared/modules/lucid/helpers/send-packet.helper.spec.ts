import { calculateTransferToken, updateTransferModuleAssets } from './send-packet.helper';

describe('send-packet helper', () => {
  test('calculateTransferToken adds delta to current asset amount', () => {
    const assets = {
      lovelace: 5_000_000n,
      tokenA: 10n,
    };

    expect(calculateTransferToken(assets, -4n, 'tokenA')).toBe(6n);
    expect(calculateTransferToken(assets, 3n, 'tokenA')).toBe(13n);
  });

  test('updateTransferModuleAssets removes denom when updated amount is zero', () => {
    const assets = {
      lovelace: 5_000_000n,
      tokenA: 20n,
    };

    const updatedAssets = updateTransferModuleAssets(assets, -20n, 'tokenA');

    expect(updatedAssets).toEqual({
      lovelace: 5_000_000n,
    });
    expect(updatedAssets.tokenA).toBeUndefined();
  });

  test('updateTransferModuleAssets strips all zero-valued entries', () => {
    const assets = {
      lovelace: 5_000_000n,
      tokenA: 0n,
      tokenB: 8n,
    };

    const updatedAssets = updateTransferModuleAssets(assets, -8n, 'tokenB');

    expect(updatedAssets).toEqual({
      lovelace: 5_000_000n,
    });
    expect(updatedAssets.tokenA).toBeUndefined();
    expect(updatedAssets.tokenB).toBeUndefined();
  });
});
