import { assertEquals } from "@std/assert";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { createCardanoScalusEvaluator } from "./scalus-evaluator.ts";
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
  const local = await createCardanoScalusEvaluator().evaluate({
    tx: tx.to_cbor_hex(),
    additionalUTxOs: utxos,
    context: {
      protocolParameters: config.protocolParameters!,
      costModels: config.costModels!,
      network: config.network!,
      slotConfig: slots,
    },
  });
  assertEquals(await f.emulator.evaluateTx(tx.to_cbor_hex()), local);
});
