import { assertEquals } from "@std/assert";

import {
  Data,
  Lucid,
  mintingPolicyToId,
  type Script,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import extended from "../scripts/fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};
import {
  createCardanoScalusEvaluator,
  isScriptEvaluationFailure,
  ScriptEvaluationFailure,
} from "./scalus-evaluator.ts";
import pv11 from "../../../chains/cardano/config/protocol-parameters.json" with {
  type: "json",
};

// Encoded without optimization by `aiken uplc encode --cbor --hex` (1.1.21).
// Each lambda evaluates its argument before returning unit. These operations
// must survive so a protocol-selection or cost-table regression is observable.
// (program 1.1.0 (lam context [(lam compared (con unit ()))
//   [[(builtin equalsString) (con string "éééééééééé")] (con string "éééééééééé")]]))
const unicode =
  "5839010100232498cdcba48114c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a900490114c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a9c3a90001";
// (program 1.1.0 (lam context [(lam ignored (con unit ()))
//   [[[(builtin andByteString) (con bool True)] (con bytestring #ff)] (con bytestring #0f)]]))
const bitwise = "55010100232498ccde5a51488101ff004881010f0001";

async function evaluationFixture(script: string, costs: number[]) {
  const account = generateEmulatorAccount({ lovelace: 100_000_000n });
  const emulator = new Emulator([account]);
  emulator.protocolParameters.costModels.PlutusV3 = costs;
  const lucid = await Lucid(emulator, "Custom", {
    evaluator: createCardanoScalusEvaluator(),
  });
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const policy: Script = { type: "PlutusV3", script };
  const completed = await lucid.newTx()
    .mintAssets({ [mintingPolicyToId(policy)]: 1n }, Data.void())
    .attach.MintingPolicy(policy).complete({ localUPLCEval: true });
  const config = lucid.config();
  const utxos = await emulator.getUtxos(account.address);
  return {
    completed,
    emulator,
    input: {
      tx: completed.toTransaction().to_cbor_hex(),
      additionalUTxOs: utxos,
      context: {
        protocolParameters: config.protocolParameters!,
        costModels: config.costModels!,
        network: config.network!,
        slotConfig: SLOT_CONFIG_NETWORK.Custom,
      },
    },
  };
}

function budget(
  redeemers: Array<{ ex_units: { mem: number; steps: number } }>,
) {
  assertEquals(redeemers.length, 1);
  const units = redeemers[0].ex_units;
  return { memory: BigInt(units.mem), cpu: BigInt(units.steps) };
}

Deno.test("script rejection detection does not accept unrelated errors", () => {
  const failure = new ScriptEvaluationFailure(
    "Error evaluated",
    new Error("Scalus rejection"),
  );
  assertEquals(isScriptEvaluationFailure(failure), true);
  assertEquals(
    isScriptEvaluationFailure({ cause: { evaluatorCause: failure } }),
    true,
  );
  assertEquals(
    isScriptEvaluationFailure(
      new Error("failed script execution: Error evaluated"),
    ),
    false,
  );
  assertEquals(
    isScriptEvaluationFailure({ cause: new Error("provider unavailable") }),
    false,
  );
});

Deno.test("the configured Scalus evaluator uses protocol 11 costing", async () => {
  const { input } = await evaluationFixture(unicode, pv11.costModels.PlutusV3);
  const actual = budget(await createCardanoScalusEvaluator().evaluate(input));
  // The protocol-11 UTF-8 costing change makes this a regression check for
  // accidentally selecting an older protocol or the upstream default.
  assertEquals(actual, { memory: 1201n, cpu: 480070n });
});

for (
  const [label, costs] of [
    ["350-entry protocol-11", pv11.costModels.PlutusV3],
    ["350-entry extended", extended.plutusV3CostModel],
  ] as const
) {
  Deno.test(`Scalus evaluator executes bitwise builtins with the ${label} profile`, async () => {
    const { input, completed, emulator } = await evaluationFixture(
      bitwise,
      costs,
    );
    const units = budget(await createCardanoScalusEvaluator().evaluate(input));
    assertEquals(units, { memory: 1401n, cpu: 309726n });
    const signed = await completed.sign.withWallet().complete();
    await signed.submit();
    emulator.awaitBlock();
    console.log({ label, ...units });
  });
}
