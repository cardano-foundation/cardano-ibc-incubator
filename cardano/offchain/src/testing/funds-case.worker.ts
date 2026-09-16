/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { assert, assertEquals } from "@std/assert";
import {
  sendPacketFixture,
  type SendParameters,
} from "./send-budget-fixture.ts";
import {
  assertTransactionAccepted,
  assertTransactionRejected,
} from "./transaction-fuzz.ts";
import {
  assertFundsState,
  firstPacket,
  knownVoucher,
  nextSend,
  receiveNative,
  receiverBalance,
  settle,
  type Settlement,
} from "./funds-lifecycle.ts";

export interface FundsCase {
  parameters: SendParameters;
  voucherBase?: string;
  amounts: bigint[];
  commands: { send: boolean; index: number; settlement: Settlement }[];
}

let stage = "initialize";

async function checkCase(sample: FundsCase) {
  const f = await sendPacketFixture(sample.parameters);
  stage = "initial send";
  await assertTransactionAccepted(f);
  const history = {
    nextSend: sample.parameters.sequence + 1n,
    transitions: 0n,
    received: [] as bigint[],
  };
  let escrow = sample.parameters.amount;
  let refunded = 0n;
  const pending = [firstPacket(f)];
  const audit = async () => {
    await assertFundsState(
      f,
      escrow,
      pending.map((p) => p.packet.fields[0] as bigint),
      history,
    );
    // Native token payouts are exact. ADA payouts include ledger minimum ADA.
    const received = await receiverBalance(f);
    if (sample.parameters.asset) {
      assertEquals(received, refunded);
    } else {
      assert(
        received >= refunded,
        "ADA recipients must receive the full principal",
      );
    }
  };
  await audit();
  // A valid generated first-mint baseline precedes every corresponding mutation.
  for (
    const mutation of [
      "short_escrow",
      "excess_escrow",
      "wrong_callback",
      "wrong_commitment",
    ] as const
  ) {
    stage = `initial send mutation ${mutation}`;
    await assertTransactionRejected(
      await sendPacketFixture(sample.parameters, mutation),
    );
  }
  let cursor = 0;
  const send = async () => {
    const amount = sample.amounts[cursor++ % sample.amounts.length];
    stage = `send ${amount}`;
    const valid = await nextSend(f, amount);
    const completed = await valid.tx.complete({ localUPLCEval: true });
    for (const mutation of ["short", "excess", "wrong_callback"] as const) {
      await assertTransactionRejected(await nextSend(f, amount, mutation));
    }
    await (await completed.sign.withWallet().complete()).submit();
    f.emulator.awaitBlock();
    pending.push(valid.sent);
    history.nextSend++;
    history.transitions++;
    escrow += amount;
    await audit();
  };
  const resolve = async (index: number, kind: Settlement) => {
    const chosen = index % pending.length;
    const packet = pending[chosen];
    stage = `${kind} packet ${packet.packet.fields[0]}`;
    const valid = await settle(f, packet, kind);
    const completed = await valid.tx.complete({ localUPLCEval: true });
    for (const mutation of ["wrong_callback", "wrong_proof"] as const) {
      await assertTransactionRejected(await settle(f, packet, kind, mutation));
    }
    if (kind !== "ack") {
      await assertTransactionRejected(
        await settle(f, packet, kind, "wrong_recipient"),
      );
      if (sample.parameters.asset) {
        for (const mutation of ["short", "excess"] as const) {
          await assertTransactionRejected(
            await settle(f, packet, kind, mutation),
          );
        }
      }
    }
    // Reset the simulated counterparty consensus after the wrong-proof case.
    await settle(f, packet, kind);
    await (await completed.sign.withWallet().complete()).submit();
    f.emulator.awaitBlock();
    pending.splice(chosen, 1);
    history.transitions++;
    if (kind !== "ack") {
      escrow -= packet.amount;
      refunded += packet.amount;
    }
    await audit();
    // A freshly built transaction spends the current state, so this rejection
    // exercises the packet replay guard rather than a ledger double-spend.
    await assertTransactionRejected(await settle(f, packet, "ack"));
    await audit();
  };
  await send(); // Guarantee overlapping in-flight packets before random commands.
  for (const command of sample.commands) {
    if (command.send || pending.length === 0) await send();
    else await resolve(command.index, command.settlement);
  }
  // Exercise every terminal operation in each case while varying the history
  // and packet selected for it. Successful ack leaves escrow for later receive.
  for (const kind of ["ack", "error", "timeout"] as const) {
    if (!pending.length) await send();
    await resolve(sample.commands.length, kind);
  }
  while (pending.length) await resolve(pending.length - 1, "error");
  const receive = async (amount: bigint, sequence: bigint, replay: boolean) => {
    stage = `receive ${amount} sequence ${sequence}`;
    const valid = await receiveNative(f, amount, sequence);
    const completed = await valid.tx.complete({ localUPLCEval: true });
    for (
      const mutation of [
        "wrong_callback",
        "wrong_proof",
        "wrong_recipient",
      ] as const
    ) {
      await assertTransactionRejected(
        await receiveNative(f, amount, sequence, mutation),
      );
    }
    if (sample.parameters.asset) {
      await assertTransactionRejected(
        await receiveNative(f, amount, sequence, "short"),
      );
    }
    await receiveNative(f, amount, sequence);
    await (await completed.sign.withWallet().complete()).submit();
    f.emulator.awaitBlock();
    history.transitions++;
    history.received.push(sequence);
    escrow -= amount;
    refunded += amount;
    await audit();
    // Replaying a receive is rebuilt against its recorded receipt.
    if (replay) {
      await assertTransactionRejected(await receiveNative(f, amount, sequence));
    }
    await audit();
  };
  if (escrow > 1n) await receive(escrow / 2n, 1n, true);
  if (escrow > 0n) await receive(escrow, 2n, false);
}

self.onmessage = async ({ data }: MessageEvent<FundsCase>) => {
  try {
    if (data.voucherBase) await checkVoucherCase(data);
    else await checkCase(data);
    self.postMessage({});
  } catch (error) {
    self.postMessage({
      error: `${stage}: ${
        error instanceof Error ? error.stack : String(error)
      }`,
    });
  }
};

async function checkVoucherCase(sample: FundsCase) {
  const f = await sendPacketFixture(sample.parameters);
  stage = "voucher setup native send";
  await assertTransactionAccepted(f);
  const history = {
    nextSend: sample.parameters.sequence + 1n,
    transitions: 0n,
    received: [] as bigint[],
  };
  const voucher = await knownVoucher(f, sample.voucherBase!);
  const pending = [] as ReturnType<typeof firstPacket>[];
  let supply = 0n;
  const audit = async () => {
    const utxos = await f.lucid.utxosAt(f.account.address);
    assertEquals(
      utxos.reduce((n, u) => n + (u.assets[voucher.unit] ?? 0n), 0n),
      supply,
    );
    await assertFundsState(f, sample.parameters.amount, [
      1n,
      ...pending.map((p) => p.packet.fields[0] as bigint),
    ], history);
    const metadata = await f.lucid.utxoByUnit(
      Object.keys(voucher.metadata.assets).find((unit) => unit !== "lovelace")!,
    );
    assertEquals(metadata.datum, voucher.metadata.datum);
    assertEquals(metadata.assets, voucher.metadata.assets);
  };
  const total = sample.amounts.reduce((a, b) => a + b, 0n) * 3n;
  stage = "voucher receive mint";
  const receive = await receiveNative(f, total, 1n, "none", voucher);
  const received = await receive.tx.complete({ localUPLCEval: true });
  for (
    const mutation of [
      "short",
      "excess",
      "wrong_callback",
      "wrong_proof",
      "wrong_recipient",
    ] as const
  ) {
    await assertTransactionRejected(
      await receiveNative(f, total, 1n, mutation, voucher),
    );
  }
  await receiveNative(f, total, 1n, "none", voucher);
  await (await received.sign.withWallet().complete()).submit();
  f.emulator.awaitBlock();
  supply += total;
  history.transitions++;
  history.received.push(1n);
  await audit();
  await assertTransactionRejected(
    await receiveNative(f, total, 1n, "none", voucher),
  );
  let sentCount = 0;
  const send = async () => {
    const amount = sample.amounts[sentCount++];
    stage = `voucher burn ${amount}`;
    const send = await nextSend(f, amount, "none", voucher);
    const sent = await send.tx.complete({ localUPLCEval: true });
    for (const mutation of ["short", "excess", "wrong_callback"] as const) {
      await assertTransactionRejected(
        await nextSend(f, amount, mutation, voucher),
      );
    }
    await (await sent.sign.withWallet().complete()).submit();
    f.emulator.awaitBlock();
    supply -= amount;
    pending.push(send.sent);
    history.nextSend++;
    history.transitions++;
    await audit();
  };
  const missing = new Set<Settlement>(["ack", "error", "timeout"]);
  const resolve = async (selected: number, requested: Settlement) => {
    const index = selected % pending.length;
    const packet = pending[index];
    // Reserve enough packets to exercise all terminal operations per history.
    const remaining = pending.length + sample.amounts.length - sentCount;
    const kind = remaining === missing.size
      ? missing.values().next().value!
      : requested;
    stage = `voucher ${kind}`;
    const settled = await settle(f, packet, kind, "none", voucher);
    const completed = await settled.tx.complete({ localUPLCEval: true });
    for (const mutation of ["wrong_callback", "wrong_proof"] as const) {
      await assertTransactionRejected(
        await settle(f, packet, kind, mutation, voucher),
      );
    }
    if (kind !== "ack") {
      for (const mutation of ["short", "excess", "wrong_recipient"] as const) {
        await assertTransactionRejected(
          await settle(f, packet, kind, mutation, voucher),
        );
      }
    }
    await settle(f, packet, kind, "none", voucher);
    await (await completed.sign.withWallet().complete()).submit();
    f.emulator.awaitBlock();
    pending.splice(index, 1);
    history.transitions++;
    if (kind !== "ack") supply += packet.amount;
    missing.delete(kind);
    await audit();
    await assertTransactionRejected(
      await settle(f, packet, "ack", "none", voucher),
    );
    await audit();
  };
  await send();
  await send();
  for (const command of sample.commands) {
    if (
      sentCount < sample.amounts.length && (command.send || !pending.length)
    ) {
      await send();
    } else if (pending.length) {
      await resolve(command.index, command.settlement);
    }
  }
  while (sentCount < sample.amounts.length) await send();
  let cursor = 0;
  while (pending.length) {
    const command = sample.commands[cursor++ % sample.commands.length];
    await resolve(command.index, command.settlement);
  }
  assertEquals(missing.size, 0);
}
