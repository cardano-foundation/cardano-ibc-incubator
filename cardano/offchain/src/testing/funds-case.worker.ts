/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { assert, assertEquals } from "@std/assert";
import { credentialToAddress } from "@lucid-evolution/lucid";
import { assertLedgerSupply, ledgerBalances } from "./funds-oracle.ts";
import {
  sendPacketFixture,
  type SendParameters,
} from "./send-budget-fixture.ts";
import {
  assertTransactionAccepted,
  assertTransactionRejected,
  completeTransaction,
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
  destinations?: { hash: string; script: boolean }[];
  amounts: bigint[];
  commands: { send: boolean; index: number; settlement: Settlement }[];
}

let stage = "initialize";
function enterStage(next: string) {
  stage = next;
  console.log("Funds stage:", stage);
}

async function checkCase(sample: FundsCase) {
  const f = await sendPacketFixture(sample.parameters);
  const nativeSupply = [
    ...ledgerBalances(f.emulator, f.funds.assetUnit).values(),
  ]
    .reduce((a, b) => a + b, 0n);
  enterStage("initial send");
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
      pending,
      history,
    );
    // Native token payouts are exact. ADA payouts include ledger minimum ADA.
    const received = await receiverBalance(f);
    if (sample.parameters.asset) {
      assertLedgerSupply(f.emulator, f.funds.assetUnit, nativeSupply);
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
    enterStage(`initial send mutation ${mutation}`);
    await assertTransactionRejected(
      await sendPacketFixture(sample.parameters, mutation),
    );
  }
  let cursor = 0;
  const send = async () => {
    const amount = sample.amounts[cursor++ % sample.amounts.length];
    enterStage(`send ${amount}`);
    const valid = await nextSend(f, amount);
    const completed = await completeTransaction(valid.tx);
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
    enterStage(`${kind} packet ${packet.packet.fields[0]}`);
    const valid = await settle(f, packet, kind);
    const completed = await completeTransaction(valid.tx);
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
    enterStage(`receive ${amount} sequence ${sequence}`);
    const valid = await receiveNative(f, amount, sequence);
    const completed = await completeTransaction(valid.tx);
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
  enterStage("voucher setup native send");
  await assertTransactionAccepted(f);
  const history = {
    nextSend: sample.parameters.sequence + 1n,
    transitions: 0n,
    received: [] as bigint[],
  };
  const voucher = await knownVoucher(f, sample.voucherBase!);
  const pending = [] as ReturnType<typeof firstPacket>[];
  let supply = 0n;
  const distributed = new Map<string, bigint>();
  const audit = async () => {
    assertLedgerSupply(f.emulator, voucher.unit, supply);
    const away = [...distributed.values()].reduce((a, b) => a + b, 0n);
    const expected = new Map(distributed);
    if (supply > away) expected.set(f.account.address, supply - away);
    assertEquals(ledgerBalances(f.emulator, voucher.unit), expected);
    await assertFundsState(
      f,
      sample.parameters.amount,
      [
        firstPacket(f),
        ...pending,
      ],
      history,
      supply + pending.reduce((sum, packet) => sum + packet.amount, 0n),
    );
    const metadata = await f.lucid.utxoByUnit(
      Object.keys(voucher.metadata.assets).find((unit) => unit !== "lovelace")!,
    );
    assertEquals(metadata.datum, voucher.metadata.datum);
    assertEquals(metadata.assets, voucher.metadata.assets);
  };
  const total = sample.amounts.reduce((a, b) => a + b, 0n) * 3n;
  enterStage("voucher receive mint");
  const receive = await receiveNative(f, total, 1n, "none", voucher);
  const received = await completeTransaction(receive.tx);
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
  // Move some received vouchers outside the signing wallet before burning or
  // refunding. The model must preserve every destination's balance throughout.
  for (const destination of sample.destinations ?? []) {
    const address = credentialToAddress("Custom", {
      type: destination.script ? "Script" : "Key",
      hash: destination.hash,
    });
    const amount = total / 8n;
    enterStage(`distribute vouchers to ${address}`);
    const tx = f.lucid.newTx().pay.ToAddress(address, {
      lovelace: 2_000_000n,
      [voucher.unit]: amount,
    });
    const completed = await completeTransaction(tx);
    await (await completed.sign.withWallet().complete()).submit();
    f.emulator.awaitBlock();
    distributed.set(address, (distributed.get(address) ?? 0n) + amount);
    await audit();
  }
  let sentCount = 0;
  const send = async () => {
    const amount = sample.amounts[sentCount++];
    enterStage(`voucher burn ${amount}`);
    const send = await nextSend(f, amount, "none", voucher);
    const sent = await completeTransaction(send.tx);
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
    enterStage(`voucher ${kind}`);
    const settled = await settle(f, packet, kind, "none", voucher);
    const completed = await completeTransaction(settled.tx);
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
