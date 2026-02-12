import { Assets } from '@lucid-evolution/lucid';

export function calculateTransferToken(assets: Assets, transferAmount: bigint, denom: string): bigint {
  const currentAmount = assets[denom] ?? BigInt(0);
  return currentAmount + transferAmount;
}

export function updateTransferModuleAssets(assets: Assets, transferAmount: bigint, denom: string): Assets {
  const updatedAssets: Assets = {
    ...assets,
    [denom]: calculateTransferToken(assets, transferAmount, denom),
  };

  for (const [assetUnit, amount] of Object.entries(updatedAssets)) {
    if (amount === 0n) {
      delete updatedAssets[assetUnit];
    }
  }

  return updatedAssets;
}
