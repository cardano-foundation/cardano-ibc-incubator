import { type Emulator } from "@lucid-evolution/provider";
import { type UTxO } from "@lucid-evolution/lucid";
import {
  decodePacketLaneHistoryTransaction,
  type PacketLaneDeployment,
  PacketLaneHistory,
} from "../packet-lane-transactions.ts";

/** Retain canonical transaction evidence independently of the live emulator UTxOs. */
export function trackPacketLaneHistory(emulator: Emulator) {
  const transactions = new Map<
    string,
    ReturnType<typeof decodePacketLaneHistoryTransaction>
  >();
  const submit = emulator.submitTx.bind(emulator);
  emulator.submitTx = async (cbor) => {
    const hash = await submit(cbor);
    transactions.set(hash, decodePacketLaneHistoryTransaction(cbor, hash));
    return hash;
  };
  const caches = new Map<string, PacketLaneHistory>();
  const resolve = (deployment: PacketLaneDeployment, target: UTxO) => {
    const unit = Object.keys(target.assets).find((unit) =>
      unit.startsWith(deployment.statePolicy)
    )!;
    const cached = caches.get(unit);
    const pending = [];
    let current = target;
    let history = new PacketLaneHistory(unit, deployment.batchPolicy);
    while (true) {
      const checkpoint = cached?.current();
      if (
        checkpoint?.txHash === current.txHash &&
        checkpoint.outputIndex === current.outputIndex
      ) {
        history = cached!.clone();
        break;
      }
      const tx = transactions.get(current.txHash);
      if (!tx) throw new Error("Missing packet lane transaction history");
      pending.push(tx);
      if (tx.mint.get(unit) === 1n) break;
      const predecessors = tx.inputs.flatMap((input) =>
        transactions.get(input.txHash)?.outputs.filter((output) =>
          output.outputIndex === input.outputIndex && output.assets[unit] === 1n
        ) ?? []
      );
      if (predecessors.length !== 1) {
        throw new Error("Missing packet lane predecessor");
      }
      current = predecessors[0];
    }
    for (const tx of pending.reverse()) history.apply(tx);
    const tree = history.at(target);
    caches.set(unit, history);
    return Promise.resolve(tree);
  };
  return { resolve, reset: () => caches.clear(), transactions };
}
