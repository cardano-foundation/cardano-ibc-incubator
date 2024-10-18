import { Assets } from '@lucid-evolution/lucid';

export function calculateTransferToken(assets: Assets, transferAmount: bigint, denom: string): bigint {
  const currentAmount = assets[denom] ?? BigInt(0);
  return currentAmount + transferAmount;
}
