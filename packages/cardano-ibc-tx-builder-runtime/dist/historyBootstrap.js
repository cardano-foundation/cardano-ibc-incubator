"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireHistoryStart = requireHistoryStart;
exports.requireHistoryBootstrap = requireHistoryBootstrap;
const fail = (message) => { throw new Error(`Invalid bridge history bootstrap: ${message}`); };
const natural = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const hash = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
function requireHistoryStart(value, networkMagic) {
    if (!natural(networkMagic))
        return fail('invalid network magic');
    if (value === 'origin') {
        if ([1, 2, 764824073].includes(networkMagic))
            return fail('public networks require an explicit checkpoint before deployment');
        return 'origin';
    }
    const point = value;
    if (!point || !natural(point.slot) || point.slot === 0 || !natural(point.block_height) || !hash(point.block_hash)) {
        return fail('invalid checkpoint slot, block height or hash');
    }
    return { slot: point.slot, block_hash: point.block_hash, block_height: point.block_height };
}
function requireHistoryBootstrap(value, networkMagic) {
    if (!value || typeof value !== 'object')
        return fail('history is required; upgrade the manifest from retained chain history');
    const h = value;
    if (h.format !== 'cardano-history-v1')
        return fail('unsupported history format');
    if (!h.host_state_nft_mint || !hash(h.host_state_nft_mint.tx_hash) || !natural(h.host_state_nft_mint.output_index))
        return fail('invalid HostState NFT creation output');
    return {
        format: h.format,
        start: requireHistoryStart(h.start, networkMagic),
        host_state_nft_mint: { tx_hash: h.host_state_nft_mint.tx_hash, output_index: h.host_state_nft_mint.output_index },
    };
}
