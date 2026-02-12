import { Assets } from '@lucid-evolution/lucid';

export function calculateTransferToken(assets: Assets, transferAmount: bigint, denom: string): bigint {
  const currentAmount = assets[denom] ?? BigInt(0);
  return currentAmount + transferAmount;
}

export function updateTransferModuleAssets(assets: Assets, transferAmount: bigint, denom: string): Assets {
  // Start from a shallow copy of all current assets and apply the delta to the target unit.
  const updatedAssets: Assets = {
    ...assets,
    [denom]: calculateTransferToken(assets, transferAmount, denom),
  };

  // Lucid/Cardano outputs should not carry zero-value asset entries.
  // Removing them keeps output assets canonical and easier to compare in tests.
  for (const [assetUnit, amount] of Object.entries(updatedAssets)) {
    if (amount === 0n) {
      delete updatedAssets[assetUnit];
    }
  }

  return updatedAssets;
}
