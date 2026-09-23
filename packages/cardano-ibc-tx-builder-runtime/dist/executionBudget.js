"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseExecutionLimit = parseExecutionLimit;
exports.assertExecutionBudget = assertExecutionBudget;
function parseExecutionLimit(value, name) {
    if ((typeof value !== 'bigint' || value <= 0n) &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) &&
        (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) {
        throw new Error(`Missing or invalid ledger execution limit ${name}`);
    }
    return BigInt(value);
}
/** Evaluation estimates scripts independently; ledger limits apply to their sum. */
function assertExecutionBudget(redeemers, limits) {
    const { maxTxExMem, maxTxExSteps } = limits;
    if (typeof maxTxExMem !== 'bigint' || maxTxExMem <= 0n ||
        typeof maxTxExSteps !== 'bigint' || maxTxExSteps <= 0n) {
        throw new Error('Missing or invalid ledger transaction execution limits');
    }
    let memory = 0n, steps = 0n;
    // CML normalizes both the legacy array and Conway map representation.
    const entries = redeemers?.to_flat_format();
    for (let i = 0; entries && i < entries.len(); i++) {
        const units = entries.get(i).ex_units();
        memory += units.mem();
        steps += units.steps();
    }
    if (memory > maxTxExMem || steps > maxTxExSteps) {
        throw new Error(`Transaction exceeds ledger execution limits: memory ${memory}/${maxTxExMem}, steps ${steps}/${maxTxExSteps}`);
    }
    return { memory, steps };
}
