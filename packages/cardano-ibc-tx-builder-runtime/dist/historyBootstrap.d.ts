/** Deployment-stable replay boundary. Chain sync resumes AFTER start. */
export type HistoryBootstrap = {
    format: 'cardano-history-v1';
    start: 'origin' | {
        slot: number;
        block_hash: string;
        block_height: number;
    };
    host_state_nft_mint: {
        tx_hash: string;
        output_index: number;
    };
};
export declare function requireHistoryStart(value: unknown, networkMagic: number): HistoryBootstrap['start'];
export declare function requireHistoryBootstrap(value: unknown, networkMagic: number): HistoryBootstrap;
