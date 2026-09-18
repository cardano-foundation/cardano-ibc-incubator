import type { CML } from '@lucid-evolution/lucid';
export declare function parseExecutionLimit(value: unknown, name: string): bigint;
/** Evaluation estimates scripts independently; ledger limits apply to their sum. */
export declare function assertExecutionBudget(redeemers: CML.Redeemers | undefined, limits: {
    maxTxExMem?: unknown;
    maxTxExSteps?: unknown;
}): {
    memory: bigint;
    steps: bigint;
};
