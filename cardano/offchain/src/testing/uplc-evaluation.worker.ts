/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import {
  CML,
  type EvalRedeemer,
  fromHex,
  utxoToTransactionInput,
  utxoToTransactionOutput,
} from "@lucid-evolution/lucid";
import { eval_phase_two_raw } from "@lucid-evolution/uplc";
import type { EvaluationRequest } from "./isolated-evaluation.ts";

self.onmessage = ({ data }: MessageEvent<EvaluationRequest>) => {
  try {
    // Same engine, cost models, limits and slot configuration as Lucid's local
    // evaluator. Evaluate every Mint/Spend purpose and return its measured cost.
    const evaluated = eval_phase_two_raw(
      fromHex(data.tx),
      data.utxos.map((u) => utxoToTransactionInput(u).to_cbor_bytes()),
      data.utxos.map((u) => utxoToTransactionOutput(u).to_cbor_bytes()),
      data.costModels,
      data.maxSteps,
      data.maxMemory,
      BigInt(data.slotConfig.zeroTime),
      BigInt(data.slotConfig.zeroSlot),
      data.slotConfig.slotLength,
    );
    const tags = [
      "spend",
      "mint",
      "publish",
      "withdraw",
      "vote",
      "propose",
    ] as const;
    const result: EvalRedeemer[] = evaluated.map((bytes) => {
      const redeemer = CML.LegacyRedeemer.from_cbor_bytes(bytes);
      const tag = tags[redeemer.tag()];
      if (!tag) throw new Error("Unknown redeemer tag");
      return {
        redeemer_tag: tag,
        redeemer_index: Number(redeemer.index()),
        ex_units: {
          mem: Number(redeemer.ex_units().mem()),
          steps: Number(redeemer.ex_units().steps()),
        },
      };
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
