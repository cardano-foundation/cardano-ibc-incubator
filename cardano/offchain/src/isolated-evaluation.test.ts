import { assertEquals } from "@std/assert";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { createCardanoScalusEvaluator } from "./scalus-evaluator.ts";
import {
  packetLaneFixture,
  signMeasured,
} from "./testing/packet-lane-fixture.ts";
import { buildPacketSendBatch } from "./packet-lane-transactions.ts";

Deno.test("isolated evaluator matches local budgets for every redeemer after a submitted send", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(2);
  const batcher = await f.wallet();
  const now = f.emulator.now();
  const first = await buildPacketSendBatch(
    batcher,
    f.deployment,
    [intents[0]],
    now,
    now + 60_000,
  );
  await (await signMeasured(batcher, first.tx, "isolated evaluator first send"))
    .submit();
  f.emulator.awaitBlock();
  const next = await buildPacketSendBatch(
    batcher,
    f.deployment,
    [intents[1]],
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  const completed = await next.tx.complete({ localUPLCEval: true });
  const tx = completed.toTransaction();
  const config = batcher.config();
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
