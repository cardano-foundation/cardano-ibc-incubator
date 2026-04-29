export type VoucherMetadataRegistryEntry = {
  decimals?: number;
  url?: string;
  logo?: string;
  name?: string;
  description?: string;
  ticker?: string;
  sourceChain?: string;
  sourceChannel?: string;
  port?: string;
};

// V1 intentionally starts empty: bridge operators can curate entries here for
// assets whose decimals / logo / URL are known and stable.
export const VOUCHER_METADATA_REGISTRY: Record<
  string,
  VoucherMetadataRegistryEntry
> = {};
