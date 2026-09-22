import {
  CML,
  type EvalRedeemer,
  type LucidEvolution,
  type Network,
  type ProtocolParameters,
  type Provider,
  SLOT_CONFIG_NETWORK,
  type SlotConfig,
  type TxBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";

export interface EvaluationRequest {
  tx: string;
  utxos: UTxO[];
  protocolParameters: ProtocolParameters;
  costModels: Uint8Array;
  network: Network;
  slotConfig: SlotConfig;
}

const isolated = new WeakSet<Provider>();

// Repeated rejected evaluations can exhaust the WASM evaluator within a long
// history. Keep the ledger in the history worker but discard the evaluator's
// entire runtime after each call, including failures.
export function isolateEvaluation(lucid: LucidEvolution, emulator: Emulator) {
  const config = lucid.config();
  if (
    config.provider !== emulator || !config.costModels ||
    !config.protocolParameters || !config.network
  ) {
    throw new Error("Isolated evaluation requires an initialized emulator");
  }
  const slotConfig = SLOT_CONFIG_NETWORK[config.network];
  emulator.evaluateTx = async (tx, additional = []) => {
    const body = CML.Transaction.from_cbor_hex(tx).body();
    const refs = [];
    for (const inputs of [body.inputs(), body.reference_inputs()]) {
      if (!inputs) continue;
      for (let i = 0; i < inputs.len(); i++) {
        const input = inputs.get(i);
        refs.push({
          txHash: input.transaction_id().to_hex(),
          outputIndex: Number(input.index()),
        });
      }
    }
    const available = new Map(
      [...await emulator.getUtxosByOutRef(refs), ...additional]
        .map((u) => [`${u.txHash}#${u.outputIndex}`, u]),
    );
    const utxos = refs.map((ref) => {
      const utxo = available.get(`${ref.txHash}#${ref.outputIndex}`);
      if (!utxo) throw new Error("Missing input for compiled evaluation");
      // Match Lucid's local evaluator: hashed datums come from witnesses.
      return { ...utxo, datum: utxo.datumHash ? undefined : utxo.datum };
    });
    const worker = new Worker(
      new URL("./uplc-evaluation.worker.ts", import.meta.url),
      { type: "module" },
    );
    try {
      return await new Promise<EvalRedeemer[]>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<{
          result?: EvalRedeemer[];
          error?: string;
        }>) => {
          if (data.error !== undefined) reject(new Error(data.error));
          else if (data.result) resolve(data.result);
          else reject(new Error("Missing compiled evaluation result"));
        };
        worker.onerror = (event) => {
          event.preventDefault();
          reject(new Error(event.message));
        };
        worker.onmessageerror = () =>
          reject(new Error("Invalid evaluation result"));
        worker.postMessage(
          {
            tx,
            utxos,
            protocolParameters: config.protocolParameters!,
            costModels: config.costModels!.to_cbor_bytes(),
            network: config.network!,
            slotConfig,
          } satisfies EvaluationRequest,
        );
      });
    } finally {
      worker.terminate();
    }
  };
  isolated.add(emulator);
}

export function completeTransaction(tx: TxBuilder) {
  // Provider evaluation is safe only for our installed real UPLC evaluator.
  // The ordinary emulator provider merely echoes budgets and must never be used.
  return tx.complete({
    localUPLCEval: !isolated.has(tx.lucidConfig().provider),
  });
}
