import type { IbcTreeLucidService } from './ibcStateRoot';
/** Public leaves only. The caller must authenticate the complete rebuilt HostState root. */
export declare function createKupoConsensusHistoryReader(endpoint: string, options?: {
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
}): NonNullable<IbcTreeLucidService['consensusHistoryRecords']>;
