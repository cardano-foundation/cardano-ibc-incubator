/* tslint:disable */
/* eslint-disable */
export function eval_phase_two_raw(transaction: Uint8Array, inputs: Uint8Array[], outputs: Uint8Array[], cost_models: Uint8Array, cpu: bigint, memory: bigint, zero_time: bigint, zero_slot: bigint, slot_length: number): Uint8Array[];
/**
 * Explicit protocol selection for callers that possess ledger parameters.
 * Never infer the active protocol from the cost-table length.
 */
export function eval_phase_two_raw_with_protocol(transaction: Uint8Array, inputs: Uint8Array[], outputs: Uint8Array[], cost_models: Uint8Array, cpu: bigint, memory: bigint, zero_time: bigint, zero_slot: bigint, slot_length: number, protocol_major_version: number): Uint8Array[];
export function apply_params_to_script(parameters: Uint8Array, script: Uint8Array): Uint8Array;
