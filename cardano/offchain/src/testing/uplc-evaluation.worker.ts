/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { createCardanoScalusEvaluator } from "../scalus-evaluator.ts";
import { CML } from "@lucid-evolution/lucid";
import type { EvaluationRequest } from "./isolated-evaluation.ts";

self.onmessage = async ({ data }: MessageEvent<EvaluationRequest>) => {
  try {
    const result = await createCardanoScalusEvaluator().evaluate({
      tx: data.tx,
      additionalUTxOs: data.utxos,
      context: {
        protocolParameters: data.protocolParameters,
        costModels: CML.CostModels.from_cbor_bytes(data.costModels),
        network: data.network,
        slotConfig: data.slotConfig,
      },
    });
    self.postMessage({ result });
  } catch (error) {
    // Never relabel a WASM trap, timeout or decoding error as script rejection.
    self.postMessage({
      error: error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : JSON.stringify(error),
    });
  }
};
