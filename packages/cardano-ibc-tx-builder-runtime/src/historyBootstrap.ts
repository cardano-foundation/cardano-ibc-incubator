/** Deployment-stable replay boundary. Chain sync resumes AFTER start. */
export type HistoryBootstrap = {
  format: 'cardano-history-v1';
  start: 'origin' | { slot: number; block_hash: string; block_height: number };
  host_state_nft_mint: { tx_hash: string; output_index: number };
};

const fail = (message: string): never => { throw new Error(`Invalid bridge history bootstrap: ${message}`); };
const natural = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const hash = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

export function requireHistoryStart(value: unknown, networkMagic: number): HistoryBootstrap['start'] {
  if (!natural(networkMagic)) return fail('invalid network magic');
  if (value === 'origin') {
    if ([1, 2, 764824073].includes(networkMagic)) return fail('public networks require an explicit checkpoint before deployment');
    return 'origin';
  }
  const point = value as Exclude<HistoryBootstrap['start'], 'origin'> | undefined;
  if (!point || !natural(point.slot) || point.slot === 0 || !natural(point.block_height) || !hash(point.block_hash)) {
    return fail('invalid checkpoint slot, block height or hash');
  }
  return { slot: point.slot, block_hash: point.block_hash, block_height: point.block_height };
}

export function requireHistoryBootstrap(value: unknown, networkMagic: number): HistoryBootstrap {
  if (!value || typeof value !== 'object') return fail('history is required; upgrade the manifest from retained chain history');
  const h = value as HistoryBootstrap;
  if (h.format !== 'cardano-history-v1') return fail('unsupported history format');
  if (!h.host_state_nft_mint || !hash(h.host_state_nft_mint.tx_hash) || !natural(h.host_state_nft_mint.output_index)) return fail('invalid HostState NFT creation output');
  return {
    format: h.format,
    start: requireHistoryStart(h.start, networkMagic),
    host_state_nft_mint: { tx_hash: h.host_state_nft_mint.tx_hash, output_index: h.host_state_nft_mint.output_index },
  };
}
