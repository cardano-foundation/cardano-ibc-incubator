import type { UTxO } from '@lucid-evolution/lucid';

export type KupoHistoryPoint = {
  slotNo: number;
  headerHash: string;
};

type CanonicalAuthToken = {
  policyId: string;
  name: string;
  unit: string;
};

/**
 * A historical Kupo match normalized to Lucid's UTxO shape.
 *
 * Unlike Lucid's ordinary provider methods, this type deliberately retains
 * spent outputs and their canonical chain positions. `datum` is always the
 * resolved CBOR bytes of an inline datum.
 */
export type KupoHistoricalOutput = UTxO & {
  transactionIndex: number;
  createdAt: KupoHistoryPoint;
  spentAt: KupoHistoryPoint | null;
  inlineDatumHash: string;
  authToken: CanonicalAuthToken;
};

/**
 * Private extension installed on the configured Kupmios provider. Keeping the
 * endpoint and authentication headers in that provider closure prevents Kupo
 * credentials from leaking into IBC query services.
 */
export interface KupoHistoryProvider {
  getKupoHistoryAtAddressByPolicy(
    address: string,
    policyId: string,
    assetName?: string,
  ): Promise<KupoHistoricalOutput[]>;
}

export function isKupoHistoryProvider(value: unknown): value is KupoHistoryProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<KupoHistoryProvider>).getKupoHistoryAtAddressByPolicy === 'function'
  );
}
