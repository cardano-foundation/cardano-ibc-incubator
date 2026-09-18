import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  CML,
  Data,
  Lucid,
  mintingPolicyToId,
  type Script,
  SLOT_CONFIG_NETWORK,
  utxoToTransactionInput,
  utxoToTransactionOutput,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import {
  eval_phase_two_raw,
  eval_phase_two_raw_with_protocol,
} from "@lucid-evolution/uplc";
import extended from "../scripts/fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};
import pv10 from "./testing/protocol-10-local-cost-profile.json" with {
  type: "json",
};

Deno.test("Lucid and utils resolve the checksum-pinned upstream evaluator", async () => {
  const require = createRequire(import.meta.url);
  const hashes = JSON.parse(
    await Deno.readTextFile(
      new URL("../../vendor/uplc/artifact-sha256.json", import.meta.url),
    ),
  );
  for (const consumer of ["@lucid-evolution/lucid", "@lucid-evolution/utils"]) {
    const evaluator = createRequire(require.resolve(consumer)).resolve(
      "@lucid-evolution/uplc",
    );
    for (const name of ["uplc_tx.js", "uplc_tx_bg.wasm"]) {
      const bytes = await Deno.readFile(join(dirname(evaluator), name));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const actual = Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
        .join("");
      assertEquals(actual, hashes[`dist/node/${name}`], consumer);
    }
  }
});

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
  emulator.protocolParameters.costModels.PlutusV3 = Object.fromEntries(
    costs.map((cost, index) => [String(index), cost]),
  );
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const policy: Script = { type: "PlutusV3", script };
  const completed = await lucid.newTx()
    .mintAssets({ [mintingPolicyToId(policy)]: 1n }, Data.void())
    .attach.MintingPolicy(policy).complete({ localUPLCEval: true });
  const config = lucid.config();
  const utxos = await emulator.getUtxos(account.address);
  const slots = SLOT_CONFIG_NETWORK.Custom;
  const args = [
    completed.toTransaction().to_cbor_bytes(),
    utxos.map((u) => utxoToTransactionInput(u).to_cbor_bytes()),
    utxos.map((u) => utxoToTransactionOutput(u).to_cbor_bytes()),
    config.costModels!.to_cbor_bytes(),
    config.protocolParameters!.maxTxExSteps,
    config.protocolParameters!.maxTxExMem,
    BigInt(slots.zeroTime),
    BigInt(slots.zeroSlot),
    slots.slotLength,
  ] as const;
  return { args, completed, emulator };
}

function budget(redeemers: Uint8Array[]) {
  assertEquals(redeemers.length, 1);
  const units = CML.LegacyRedeemer.from_cbor_bytes(redeemers[0]).ex_units();
  return { memory: units.mem(), cpu: units.steps() };
}

Deno.test("Lucid's versionless API explicitly retains protocol 10 rather than upstream's protocol 11 default", async () => {
  const { args } = await evaluationFixture(unicode, extended.plutusV3CostModel);
  const actual = budget(eval_phase_two_raw(...args));
  const protocol10 = budget(eval_phase_two_raw_with_protocol(...args, 10));
  const protocol11 = budget(eval_phase_two_raw_with_protocol(...args, 11));
  assertEquals(actual, protocol10);
  assertEquals(protocol10, { memory: 1201n, cpu: 783040n });
  assertEquals(protocol11, { memory: 1201n, cpu: 480070n });
  // Negative control: the same valid transaction executes under both versions,
  // but UTF-8 costing differs. This catches the upstream language-only default
  // even if all ordinary scripts still pass.
  assertNotEquals(protocol10, protocol11);
  console.log({ protocol10, protocol11 });
  assertEquals(
    assertThrows(() => eval_phase_two_raw_with_protocol(...args, 12)),
    "Unsupported evaluator protocol major version",
  );
});

for (
  const [label, costs] of [
    ["297-entry protocol-10", pv10.costModels.PlutusV3],
    ["350-entry extended", extended.plutusV3CostModel],
  ] as const
) {
  Deno.test(`upstream evaluator executes bitwise builtins with the ${label} profile`, async () => {
    const { args, completed, emulator } = await evaluationFixture(
      bitwise,
      costs,
    );
    const units = budget(eval_phase_two_raw(...args));
    assertEquals(units, { memory: 1401n, cpu: 309726n });
    const signed = await completed.sign.withWallet().complete();
    await signed.submit();
    emulator.awaitBlock();
    console.log({ label, ...units });
  });
}
