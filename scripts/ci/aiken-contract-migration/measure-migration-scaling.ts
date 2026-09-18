/** Offline, compiled single-step costs at explicit retained protocol parameters.
 * State/NFTs are seeded: this is not evidence of their creation or a populated
 * lifecycle. The real node rehearsal supplies those independent checks. */
import { assert, assertEquals } from "@std/assert";
import {
  type ProtocolParameters,
  type TxSignBuilder,
} from "@lucid-evolution/lucid";
import {
  accountingFixture,
  oracleRoot,
} from "../../../cardano/offchain/src/testing/migration-accounting.ts";
import { canonicalMigrationJson } from "../../../cardano/offchain/src/migration-plan.ts";

const [parametersPath, reportPath] = Deno.args;
if (!parametersPath || !reportPath) {
  throw new Error(
    "Usage: measure-migration-scaling.ts CARDANO_CLI_PROTOCOL_PARAMETERS NEW_REPORT_JSON",
  );
}
const raw = await Deno.readTextFile(parametersPath), p = JSON.parse(raw);
const inactiveModelAdjustments: { version: string; index: number }[] = [];
function costModel(version: "PlutusV1" | "PlutusV2" | "PlutusV3") {
  const costs: unknown = p.costModels?.[version];
  if (
    !Array.isArray(costs) || costs.some((cost) => !Number.isInteger(cost))
  ) {
    throw new Error(`Missing or invalid ${version} cost model`);
  }
  return Object.fromEntries(costs.map((cost, index) => {
    if (Number.isSafeInteger(cost)) return [String(index), cost];
    if (version === "PlutusV3") {
      throw new Error(
        "Cannot measure with an inexact active PlutusV3 cost model",
      );
    }
    // Lucid requires safe JS integers even for unused language models. These
    // fixtures execute only V3; retain a visible record of inactive sentinels.
    inactiveModelAdjustments.push({ version, index });
    return [String(index), Math.sign(cost) * Number.MAX_SAFE_INTEGER];
  }));
}
if (
  p.protocolVersion?.major !== 10 || !Array.isArray(p.costModels?.PlutusV3) ||
  p.costModels.PlutusV3.length !== 297
) {
  throw new Error(
    "This rehearsal cost profile requires actual protocol-10 Plutus V3 parameters (297 entries)",
  );
}
const parameters: ProtocolParameters = {
  minFeeA: p.txFeePerByte,
  minFeeB: p.txFeeFixed,
  maxTxSize: p.maxTxSize,
  maxValSize: p.maxValueSize,
  keyDeposit: BigInt(p.stakeAddressDeposit),
  poolDeposit: BigInt(p.stakePoolDeposit),
  drepDeposit: BigInt(p.dRepDeposit),
  govActionDeposit: BigInt(p.govActionDeposit),
  priceMem: p.executionUnitPrices.priceMemory,
  priceStep: p.executionUnitPrices.priceSteps,
  maxTxExMem: BigInt(p.maxTxExecutionUnits.memory),
  maxTxExSteps: BigInt(p.maxTxExecutionUnits.steps),
  coinsPerUtxoByte: BigInt(p.utxoCostPerByte),
  collateralPercentage: p.collateralPercentage,
  maxCollateralInputs: p.maxCollateralInputs,
  minFeeRefScriptCostPerByte: p.minFeeRefScriptCostPerByte,
  costModels: {
    PlutusV1: costModel("PlutusV1"),
    PlutusV2: costModel("PlutusV2"),
    PlutusV3: costModel("PlutusV3"),
  },
};
const measurements: {
  label: string;
  dimensions: unknown;
  memory: bigint;
  cpu: bigint;
  signedBytes: number;
  fee: bigint;
  scripts: number;
}[] = [];
async function measured(
  label: string,
  complete: TxSignBuilder,
  dimensions: unknown,
) {
  const signed = await complete.sign.withWallet().complete();
  const tx = signed.toTransaction();
  const redeemers = tx.witness_set().redeemers();
  assert(redeemers, "Cost measurement must contain actual script executions");
  let memory = 0n, cpu = 0n, scripts = 0;
  const map = redeemers.as_map_redeemer_key_to_redeemer_val();
  const legacy = redeemers.as_arr_legacy_redeemer();
  if (map) {
    const keys = map.keys();
    for (let n = 0; n < keys.len(); n++) {
      const units = map.get(keys.get(n))!.ex_units();
      memory += units.mem();
      cpu += units.steps();
      scripts++;
    }
  } else if (legacy) {
    for (let n = 0; n < legacy.len(); n++) {
      const units = legacy.get(n).ex_units();
      memory += units.mem();
      cpu += units.steps();
      scripts++;
    }
  } else throw new Error("Unknown redeemer representation");
  const bytes = signed.toCBOR().length / 2;
  assertEquals(
    scripts,
    2,
    "Every object step must execute kernel and spending wrapper",
  );
  assert(
    memory <= parameters.maxTxExMem && cpu <= parameters.maxTxExSteps &&
      bytes <= parameters.maxTxSize,
    `Infeasible ${label}: ${memory} memory, ${cpu} CPU, ${bytes} signed bytes`,
  );
  const entry = {
    label,
    dimensions,
    memory,
    cpu,
    signedBytes: bytes,
    fee: tx.body().fee(),
    scripts,
  };
  measurements.push(entry);
  console.log(canonicalMigrationJson(entry));
}
for (const count of [1n, 16n, 1000n]) {
  for (const packetEntries of [0, 32, 64]) {
    const f = await accountingFixture(462, {
      protocolParameters: parameters,
      packetEntries,
      channelCount: count,
      channelIndex: count - 1n,
    });
    const move = await f.build(f.channel, f.channelReference, {
      MoveCore: { role: 3n },
    });
    await measured("channel", await move.tx.complete({ localUPLCEval: true }), {
      authenticatedChannelLimit: count,
      cursor: count - 1n,
      packetEntries,
      scope:
        "Seeded last-object cursor, not execution of preceding object moves",
    });
  }
}
for (const shards of [2, 32, 1024]) {
  const f = await accountingFixture(462, {
    protocolParameters: parameters,
    escrowShards: shards,
    channelCount: BigInt(shards),
  });
  assertEquals(await f.inventoryTree.getRoot(), oracleRoot(f.inventory));
  for (const index of [0, shards - 1]) {
    const shard = f.shards[index];
    const siblings = await f.inventoryTree.getSiblings(shard.key);
    assertEquals(siblings.length, 64);
    const move = await f.build(shard.utxo, f.transferReference, {
      MoveEscrow: { siblings },
    });
    await measured("escrow", await move.tx.complete({ localUPLCEval: true }), {
      authenticatedEscrowShards: shards,
      index,
      proofSiblings: siblings.length,
    });
  }
}
const digest = Array.from(
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
  ),
  (b) => b.toString(16).padStart(2, "0"),
).join("");
await Deno.writeTextFile(
  reportPath,
  canonicalMigrationJson({
    format: "cardano-ibc-migration-scaling-v1",
    parametersSha256: digest,
    executedLanguage: "PlutusV3",
    inactiveModelAdjustments,
    limits: {
      memory: parameters.maxTxExMem,
      cpu: parameters.maxTxExSteps,
      bytes: parameters.maxTxSize,
    },
    scope:
      "Offline compiled validators with seeded state and explicit protocol parameters; no node acceptance claim",
    measurements,
  }) + "\n",
  { createNew: true },
);
