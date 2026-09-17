//! Lucid's existing byte-oriented API backed by the pinned upstream evaluator.
//! Cost models, budgets and scripts are passed through without modification.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn eval_phase_two_raw(
    transaction: &[u8],
    inputs: Vec<js_sys::Uint8Array>,
    outputs: Vec<js_sys::Uint8Array>,
    cost_models: &[u8],
    cpu: u64,
    memory: u64,
    zero_time: u64,
    zero_slot: u64,
    slot_length: u32,
) -> Result<Vec<js_sys::Uint8Array>, JsValue> {
    if inputs.len() != outputs.len() {
        return Err(JsValue::from_str(
            "Evaluator input/output inventory length mismatch",
        ));
    }
    let utxos: Vec<_> = inputs
        .into_iter()
        .zip(outputs)
        .map(|(input, output)| (input.to_vec(), output.to_vec()))
        .collect();
    uplc::tx::eval_phase_two_raw(
        transaction,
        &utxos,
        Some(cost_models),
        (cpu, memory),
        (zero_time, zero_slot, slot_length),
        false,
        |_| (),
    )
    .map(|results| {
        results
            .into_iter()
            .map(|(redeemer, _)| js_sys::Uint8Array::from(redeemer.as_slice()))
            .collect()
    })
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn apply_params_to_script(parameters: &[u8], script: &[u8]) -> Result<Vec<u8>, JsValue> {
    uplc::tx::apply_params_to_script(parameters, script)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
