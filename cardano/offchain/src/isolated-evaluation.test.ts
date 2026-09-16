import { assertEquals } from "@std/assert";
import {
  CML,
  fromCMLRedeemerTag,
  SLOT_CONFIG_NETWORK,
  utxoToTransactionInput,
  utxoToTransactionOutput,
} from "@lucid-evolution/lucid";
import { eval_phase_two_raw } from "@lucid-evolution/uplc";
import {
  defaultSendParameters,
  sendPacketFixture,
} from "./testing/send-budget-fixture.ts";
import { assertTransactionAccepted } from "./testing/transaction-fuzz.ts";
import { nextSend } from "./testing/funds-lifecycle.ts";

Deno.test("isolated evaluator matches local budgets for every redeemer after a submitted send", async () => {
  const f = await sendPacketFixture({ ...defaultSendParameters, sequence: 1n });
  await assertTransactionAccepted(f);
  const next = await nextSend(f, 1234n);
  const completed = await next.tx.complete({ localUPLCEval: true });
  const tx = completed.toTransaction();
  const config = f.lucid.config();
  const utxos = Object.values(f.emulator.ledger)
    .filter((entry) => !entry.spent).map((entry) => entry.utxo);
  const slots = SLOT_CONFIG_NETWORK[config.network!];
  const local = eval_phase_two_raw(
    tx.to_cbor_bytes(),
    utxos.map((u) => utxoToTransactionInput(u).to_cbor_bytes()),
    utxos.map((u) => utxoToTransactionOutput(u).to_cbor_bytes()),
    config.costModels!.to_cbor_bytes(),
    config.protocolParameters!.maxTxExSteps,
    config.protocolParameters!.maxTxExMem,
    BigInt(slots.zeroTime),
    BigInt(slots.zeroSlot),
    slots.slotLength,
  ).map((bytes) => {
    const redeemer = CML.LegacyRedeemer.from_cbor_bytes(bytes);
    return {
      redeemer_tag: fromCMLRedeemerTag(redeemer.tag()),
      redeemer_index: Number(redeemer.index()),
      ex_units: {
        mem: Number(redeemer.ex_units().mem()),
        steps: Number(redeemer.ex_units().steps()),
      },
    };
  });
  assertEquals(await f.emulator.evaluateTx(tx.to_cbor_hex()), local);
});
