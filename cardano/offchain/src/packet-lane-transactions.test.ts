import { absenceProof } from "./testing/packet-budget-fixture.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CML,
  type Constr,
  Data,
  fromText,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  buildLiquidityRetirement,
  buildPacketAcknowledgement,
  buildPacketSendBatch,
  buildPacketTimeout,
  buildTransferIntentCancellation,
  encode,
  record,
} from "./packet-lane-transactions.ts";
import {
  packetLaneFixture,
  signMeasured,
  snapshot,
} from "./testing/packet-lane-fixture.ts";

Deno.test("five funded requests batch without acknowledgements and complete through independent lane transactions", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(5);
  const batcher = await f.wallet();
  const packets: Constr<Data>[] = [];
  for (
    const group of [intents.slice(0, 2), intents.slice(2, 4), intents.slice(4)]
  ) {
    const now = f.emulator.now();
    const batch = await buildPacketSendBatch(
      batcher,
      f.deployment,
      group,
      now,
      now + 60_000,
    );
    packets.push(...batch.packets);
    const sent = await signMeasured(
      batcher,
      batch.tx,
      `${group.length}-intent batch`,
    );
    await sent.submit();
    f.emulator.awaitBlock();
  }
  assertEquals(packets.map((p) => p.fields[0]), [1n, 2n, 3n, 4n, 5n]);
  const escrows = await batcher.utxosAt(f.deployment.batchAddress);
  assertEquals(escrows.length, 5);
  assertEquals(
    escrows.reduce(
      (sum, u) =>
        sum + ((Data.from(u.datum!) as Constr<Data>).fields[6] as bigint),
      0n,
    ),
    10_000_000n,
  );
  const pending = [];
  const inputs: UTxO[] = [];
  for (const packet of packets) {
    const relayer = await f.wallet();
    const proof = f.proofs.get(packet.fields[0] as bigint)!;
    const ack = await buildPacketAcknowledgement(
      relayer,
      f.deployment,
      packet,
      proof.height,
      proof.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    inputs.push(ack.input);
    pending.push(
      await signMeasured(
        relayer,
        ack.tx,
        `acknowledgement ${packet.fields[0]}`,
      ),
    );
  }
  assertEquals(
    new Set(inputs.map((u) => `${u.txHash}#${u.outputIndex}`)).size,
    5,
  );
  // Every transaction is built before any of these lane spends is submitted.
  for (const tx of pending) await tx.submit();
  f.emulator.awaitBlock();
  for (const input of inputs) {
    assertEquals((await batcher.utxosByOutRef([input])).length, 0);
  }
});

Deno.test("same-lane sends use sequential witnesses and stale packet completions rebuild safely", async () => {
  const f = await packetLaneFixture(1);
  const { intents } = await f.admit(2);
  const builder = await f.wallet();
  const batch = await buildPacketSendBatch(
    builder,
    f.deployment,
    intents,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  const lanes = batch.operation.fields[3] as Constr<Data>[];
  assertEquals(lanes.length, 1);
  const updates = lanes[0].fields[1] as Constr<Data>[];
  assertEquals(updates.length, 2);
  assert(encode(updates[0].fields[1]) !== encode(updates[1].fields[1]));
  const signed = await signMeasured(builder, batch.tx, "two sends in one lane");
  const corrupted = changeMintRedeemer(signed.toTransaction(), (operation) => {
    const lanes = operation.fields[3] as Constr<Data>[];
    const updates = lanes[0].fields[1] as Constr<Data>[];
    updates[1].fields[1] = updates[0].fields[1];
  });
  await assertRejects(
    () => f.emulator.evaluateTx(corrupted),
    Error,
    "validator crashed",
  );
  await signed.submit();
  f.emulator.awaitBlock();
  const pending = [];
  for (const packet of batch.packets) {
    const wallet = await f.wallet();
    const proof = f.proofs.get(packet.fields[0] as bigint)!;
    const ack = await buildPacketAcknowledgement(
      wallet,
      f.deployment,
      packet,
      proof.height,
      proof.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    pending.push({
      wallet,
      packet,
      proof,
      input: ack.input,
      signed: await signMeasured(wallet, ack.tx, "competing lane completion"),
    });
  }
  assertEquals(pending[0].input, pending[1].input);
  await pending[0].signed.submit();
  f.emulator.awaitBlock();
  const stale = pending[1].signed;
  await assertRejects(() => stale.submit());
  const { wallet, packet, proof } = pending[1];
  const retry = await buildPacketAcknowledgement(
    wallet,
    f.deployment,
    packet,
    proof.height,
    proof.proof,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await (await signMeasured(wallet, retry.tx, "rebuilt lane completion"))
    .submit();
  f.emulator.awaitBlock();
  await assertRejects(
    () =>
      buildPacketAcknowledgement(
        wallet,
        f.deployment,
        packet,
        proof.height,
        proof.proof,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      ),
    Error,
    "absent",
  );
});

Deno.test("competing batch builders and rollback reload included sequences and funded intents", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(2);
  const first = await f.wallet(), second = await f.wallet();
  const restore = snapshot(f);
  const build = (wallet: typeof first, intent: UTxO) =>
    buildPacketSendBatch(
      wallet,
      f.deployment,
      [intent],
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
  const a = await build(first, intents[0]), b = await build(second, intents[1]);
  assertEquals(a.packets[0].fields[0], 1n);
  assertEquals(b.packets[0].fields[0], 1n);
  const signedA = await signMeasured(first, a.tx, "first builder");
  const signedB = await signMeasured(second, b.tx, "competing builder");
  await signedA.submit();
  f.emulator.awaitBlock();
  await assertRejects(() => signedB.submit());
  const retry = await build(second, intents[1]);
  assertEquals(retry.packets[0].fields[0], 2n);
  const descendant = await signMeasured(second, retry.tx, "rebuilt batch");
  restore();
  await assertRejects(() => descendant.submit());
  const afterRollback = await build(second, intents[1]);
  assertEquals(afterRollback.packets[0].fields[0], 1n);
  await (await signMeasured(second, afterRollback.tx, "batch after rollback"))
    .submit();
  f.emulator.awaitBlock();
  assertEquals((await first.utxosByOutRef([intents[0]])).length, 1);
});

Deno.test("funded liquidity consolidates with a burn and donor reserve reimbursement", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(2);
  const wallet = await f.wallet();
  const batch = await buildPacketSendBatch(
    wallet,
    f.deployment,
    intents,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await (await signMeasured(wallet, batch.tx, "liquidity deposits")).submit();
  f.emulator.awaitBlock();
  const inputs = await wallet.utxosAt(f.deployment.batchAddress);
  await assertRejects(
    () => buildLiquidityRetirement(wallet, f.deployment, inputs),
    Error,
    "Only empty",
  );
  const tx = await buildLiquidityRetirement(wallet, f.deployment, inputs, true);
  await (await signMeasured(wallet, tx, "liquidity consolidation")).submit();
  f.emulator.awaitBlock();
  const remaining = await wallet.utxosAt(f.deployment.batchAddress);
  assertEquals(remaining.length, 1);
  assertEquals(
    (Data.from(remaining[0].datum!) as Constr<Data>).fields[6],
    4_000_000n,
  );
  assertEquals(remaining[0].assets.lovelace, 7_000_000n);
  const removed = Object.keys(inputs[1].assets).find((unit) =>
    unit !== "lovelace"
  )!;
  assertEquals(await wallet.utxoByUnit(removed), undefined);
});

Deno.test("authenticated timeout drains liquidity, burns its identity and refunds principal plus reserve", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(1);
  const wallet = await f.wallet();
  const batch = await buildPacketSendBatch(
    wallet,
    f.deployment,
    intents,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await (await signMeasured(wallet, batch.tx, "timeout deposit")).submit();
  f.emulator.awaitBlock();
  const inputs = await wallet.utxosAt(f.deployment.batchAddress);
  // Supply an authenticated later remote checkpoint as test pre-state. Client
  // update validation is covered separately, this test executes timeout proof
  // verification and release, not the remote light-client update transaction.
  f.emulator.awaitBlock(181);
  const height = record(1n, 19n);
  const absent = await absenceProof(
    fromText("receipts/ports/transfer/channels/channel-7/sequences/1"),
  );
  const client = Data.from(f.deployment.client.datum!) as Constr<Data>;
  const state = client.fields[0] as Constr<Data>;
  (state.fields[0] as Constr<Data>).fields[6] = height;
  state.fields[1] = new Map([[
    height,
    record(
      BigInt(f.emulator.now()) * 1_000_000n,
      "00".repeat(32),
      record(absent.root),
    ),
  ]]);
  state.fields[2] = new Map([[height, 0n]]);
  state.fields[3] = new Map([[height, 0n]]);
  f.deployment.client.datum = encode(client);
  const refund = await buildPacketTimeout(
    wallet,
    f.deployment,
    batch.packets[0],
    height,
    absent.proof,
    inputs,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  const signed = await signMeasured(wallet, refund.tx, "full-drain timeout");
  const corrupted = changeMintRedeemer(signed.toTransaction(), (operation) => {
    operation.fields[2] = record(1n, 20n);
  });
  await assertRejects(
    () => f.emulator.evaluateTx(corrupted),
    Error,
    "validator crashed",
  );
  await signed.submit();
  f.emulator.awaitBlock();
  assertEquals((await wallet.utxosAt(f.deployment.batchAddress)).length, 0);
  const token = Object.keys(inputs[0].assets).find((unit) =>
    unit !== "lovelace"
  )!;
  assertEquals(await wallet.utxoByUnit(token), undefined);
  await assertRejects(
    () =>
      buildPacketTimeout(
        wallet,
        f.deployment,
        batch.packets[0],
        height,
        absent.proof,
        inputs,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      ),
    Error,
    "absent",
  );
});

function changeMintRedeemer(
  transaction: CML.Transaction,
  mutate: (operation: Constr<Data>) => void,
): string {
  const witnesses = transaction.witness_set();
  const data = Data.from(witnesses.redeemers()!.to_cbor_hex());
  let found = false;
  if (data instanceof Map) {
    for (const [key, value] of data) {
      if ((key as bigint[])[0] === 1n) {
        mutate((value as Data[])[0] as Constr<Data>);
        found = true;
      }
    }
  } else {
    assert(Array.isArray(data));
    for (const value of data as Data[][]) {
      if (value[0] === 1n) {
        mutate(value[2] as Constr<Data>);
        found = true;
      }
    }
  }
  assert(found);
  witnesses.set_redeemers(CML.Redeemers.from_cbor_hex(encode(data)));
  // Evaluate scripts directly. Signatures are intentionally invalid after
  // tampering, so a submission failure alone would not test the validator.
  return CML.Transaction.new(
    transaction.body(),
    witnesses,
    true,
    transaction.auxiliary_data(),
  ).to_cbor_hex();
}

Deno.test("a funded intent can be cancelled by its owner before batching", async () => {
  const f = await packetLaneFixture();
  const { intents, users } = await f.admit(1);
  const stranger = await f.wallet();
  await assertRejects(
    () => buildTransferIntentCancellation(stranger, f.deployment, intents[0]),
    Error,
    "Only the intent owner",
  );
  const tx = await buildTransferIntentCancellation(
    users[0],
    f.deployment,
    intents[0],
  );
  await (await signMeasured(users[0], tx, "intent cancellation")).submit();
  f.emulator.awaitBlock();
  assertEquals((await users[0].utxosByOutRef(intents)).length, 0);
});
