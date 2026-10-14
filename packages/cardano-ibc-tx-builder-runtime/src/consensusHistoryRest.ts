import type { UTxO } from "@lucid-evolution/lucid";
import {
  HistoryIntersectionError,
  HistorySnapshotChangedError,
  validateHistoryBootstrap,
  type HistoryDeployment,
  type HistorySource,
  type HistoryPoint,
  type HistoryTransaction,
} from "./consensusHistoryRecovery.ts";
import { YaciRestHistory, type RestTransaction } from "./yaciRestHistory.ts";
import { YaciRestHistoryChangedError } from "./yaciRest.ts";

const evidence = (tx: RestTransaction): HistoryTransaction => ({
  txHash: tx.hash,
  blockHash: tx.block.hash,
  blockHeight: tx.block.number,
  slot: tx.block.slot,
  transactionIndex: tx.index,
  cbor: tx.bodyCborHex,
  valid: tx.valid,
});

export async function discoverRestHistoryBootstrap(
  source: YaciRestHistory,
  deployment: Pick<
    HistoryDeployment,
    "clientToken" | "stateAddress" | "allowScriptMigration"
  >,
): Promise<HistoryDeployment["bootstrap"]> {
  const unit = deployment.clientToken.policyId + deployment.clientToken.name;
  return source.snapshot("latest", async (tip) => {
    for await (const row of source.pages(`assets/${unit}/transactions`)) {
      if (!Number.isSafeInteger(row.block_height ?? row.block_number))
        throw new Error("Invalid Yaci creation history height");
      if ((row.block_height ?? row.block_number) > tip.number) continue;
      const tx = await source.transaction(row.tx_hash);
      if (!tx)
        throw new Error("Yaci client NFT creation transaction is unavailable");
      if (!tx.valid) continue;
      const outputs = tx.outputs.filter(
        (output) =>
          (deployment.allowScriptMigration ||
            output.address === deployment.stateAddress) &&
          output.amounts.some(
            (amount) => amount.unit === unit && amount.quantity === "1",
          ),
      );
      if (outputs.length !== 1)
        throw new Error(
          "Yaci client NFT creation output is absent or ambiguous",
        );
      validateHistoryBootstrap(
        evidence(tx),
        deployment.clientToken,
        outputs[0].output_index,
        deployment.allowScriptMigration ? undefined : deployment.stateAddress,
      );
      return { txHash: tx.hash, outputIndex: outputs[0].output_index };
    }
    throw new Error("Yaci client NFT creation is unavailable through REST");
  });
}

export function createRestHistorySource(
  source: YaciRestHistory,
  deployment: HistoryDeployment,
  readCurrentState: () => Promise<UTxO>,
): HistorySource {
  const unit = deployment.clientToken.policyId + deployment.clientToken.name;
  return {
    currentState: readCurrentState,
    async *transactions(
      after?: HistoryPoint,
    ): AsyncGenerator<HistoryTransaction> {
      after = after ? { ...after } : undefined;
      source.reset();
      const tip = await source.api.block("latest");
      if (!tip) throw new Error("Yaci REST tip is unavailable");
      if (after) {
        if (after.blockHeight > tip.number)
          throw new Error("Yaci REST tip is behind the resume point");
        const block = await source.api.block(after.blockHeight);
        if (!block || block.hash !== after.blockHash)
          throw new HistoryIntersectionError(
            "Yaci REST resume block is no longer canonical",
          );
        const tx = (await source.blockTransactions(after.blockHeight))[
          after.transactionIndex
        ];
        if (
          !tx?.valid ||
          tx.hash !== after.txHash ||
          tx.block.slot !== after.slot ||
          !tx.outputs.some(
            (output) =>
              (deployment.allowScriptMigration ||
                output.address === deployment.stateAddress) &&
              output.amounts.some(
                (amount) => amount.unit === unit && amount.quantity === "1",
              ),
          )
        )
          throw new Error(
            "Yaci REST resume transaction evidence is incomplete",
          );
      }
      const outputs = await source.outputs(
        {
          policy: deployment.clientToken.policyId,
          unit,
          address: deployment.allowScriptMigration
            ? undefined
            : deployment.stateAddress,
          unspent: false,
        },
        tip.number,
        after?.blockHeight ?? 0,
      ).catch((error: unknown) => {
        if (error instanceof YaciRestHistoryChangedError)
          throw new HistorySnapshotChangedError(error.message, { cause: error });
        throw error;
      });
      const seen = new Set<string>();
      for (const output of outputs) {
        if (
          after &&
          (output.block < after.blockHeight ||
            (output.block === after.blockHeight &&
              output.tx_index < after.transactionIndex))
        )
          continue;
        if (seen.has(output.tx_hash))
          throw new Error(
            "Multiple client state outputs in a historical transaction",
          );
        seen.add(output.tx_hash);
        const tx = (await source.blockTransactions(output.block)).find(
          (candidate) => candidate.hash === output.tx_hash,
        )!;
        source.api.signal?.throwIfAborted();
        yield evidence(tx);
      }
      const canonical = await source.api.block(tip.number);
      if (!canonical || canonical.hash !== tip.hash)
        throw new HistorySnapshotChangedError(
          "Yaci REST history changed during recovery",
        );
    },
  };
}
