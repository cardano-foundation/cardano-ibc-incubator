import { Assets } from '@cuonglv0297/lucid-custom';

export function calculateTransferToken(assets: Assets, transferAmount: bigint, denom: string): bigint {
  const currentAmount = assets[denom] ?? BigInt(0);
  return currentAmount + transferAmount;
}
