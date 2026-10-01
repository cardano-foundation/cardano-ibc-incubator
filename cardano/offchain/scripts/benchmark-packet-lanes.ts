/** Signed local contention benchmark. Emulator time is not chain latency. */
import { assert, assertEquals } from "@std/assert";
import { CML, type Constr, type Data } from "@lucid-evolution/lucid";
import {
  packetLaneFixture,
  signMeasured,
  snapshot,
} from "../src/testing/packet-lane-fixture.ts";
import {
  buildPacketAcknowledgement,
  buildPacketSendBatch,
  buildTransferIntent,
} from "../src/packet-lane-transactions.ts";

const output = Deno.args[0] ?? "/tmp/packet-lane-benchmark.json";
const scenarios =
  (Deno.args.slice(1).length
    ? Deno.args.slice(1)
    : ["5:1", "5:16", "16:16", "32:16", "64:16"]).map((arg) => {
      const [requests, lanes] = arg.split(":").map(Number);
      if (
        !Number.isInteger(requests) || requests < 1 || requests > 64 ||
        ![1, 16].includes(lanes)
      ) throw new Error("Use requests:lanes, requests 1..64, lanes 1 or 16");
      return { requests, lanes };
    });
const results: Record<string, unknown>[] = [];
const report = {
  mode:
    "compiled-validator emulator, authenticated fixture pre-state, no live chain submission",
  generatedAt: new Date().toISOString(),
  evaluator: Deno.env.get("PACKET_LANE_NODE_URL")
    ? "Ogmios with additional fixture UTxOs"
    : "Scalus",
  denoVersion: Deno.version.deno,
  asset: "lovelace",
  amount: "2000000",
  channel: "same channel within each scenario",
  note:
    "Wall times measure sequential local construction/signing/evaluation, not concurrent Gateway or Hermes throughput. Inclusion rounds are dependency rounds, not real blocks. Acknowledgement proofs are fixtures. Single-lane control is not the legacy implementation. Dedicated relayer fee wallets isolate protocol input contention.",
  scenarios: results,
};
for (const scenario of scenarios) {
  const result: Record<string, unknown> = { ...scenario };
  results.push(result);
  const start = performance.now();
  try {
    const f = await packetLaneFixture(
      scenario.lanes,
      Math.max(8, 2 ** Math.ceil(Math.log2(scenario.requests))),
    );
    const phases: Record<string, unknown>[] = [];
    result.transactions = phases;
    const metrics = (
      signed: Awaited<ReturnType<typeof signMeasured>>,
      phase: string,
      ms: number,
      packets = 1,
    ) => {
      const units = CML.compute_total_ex_units(
        signed.toTransaction().witness_set().redeemers()!,
      );
      phases.push({
        phase,
        packets,
        milliseconds: ms,
        bytes: signed.toCBOR().length / 2,
        memory: Number(units.mem()),
        cpu: Number(units.steps()),
      });
    };
    // Every user's transaction is prepared before any admission is submitted.
    const admissionStart = performance.now();
    const funded = [];
    const admissionInputs = new Set<string>();
    for (let i = 0; i < scenario.requests; i++) {
      const user = await f.wallet();
      const tx = await buildTransferIntent(user, f.deployment, {
        amount: 2_000_000n,
        receiver: "cosmos1receiver",
        timeoutTimestamp: BigInt(f.emulator.now() + 3_600_000) * 1_000_000n,
      });
      const signed = await (await tx.complete()).sign.withWallet().complete();
      const inputs = signed.toTransaction().body().inputs();
      for (let j = 0; j < inputs.len(); j++) {
        const input = inputs.get(j);
        const ref = `${input.transaction_id().to_hex()}#${input.index()}`;
        assert(!admissionInputs.has(ref), "admissions share an input");
        admissionInputs.add(ref);
      }
      funded.push(signed);
    }
    const hashes: string[] = [];
    for (const signed of funded) hashes.push(await signed.submit());
    f.emulator.awaitBlock();
    const intents = (await f.lucid.utxosAt(f.deployment.guardAddress)).filter((
      u,
    ) => hashes.includes(u.txHash));
    assertEquals(intents.length, scenario.requests);
    result.admission = {
      milliseconds: performance.now() - admissionStart,
      requests: intents.length,
      inclusionRounds: 1,
      sharedInputs: 0,
    };
    const batcher = await f.wallet();
    const packets: Constr<Data>[] = [];
    let fallbacks = 0;
    const rejectedBatches: string[] = [];
    const sendStart = performance.now();
    for (let offset = 0; offset < intents.length;) {
      let size = Math.min(2, intents.length - offset);
      let began = performance.now();
      const build = async () => {
        const batch = await buildPacketSendBatch(
          batcher,
          f.deployment,
          intents.slice(offset, offset + size),
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
        return {
          batch,
          signed: await signMeasured(
            batcher,
            batch.tx,
            `${scenario.requests}/${scenario.lanes}: ${size} sends at ${offset}`,
          ),
        };
      };
      let built;
      try {
        built = await build();
      } catch (error) {
        if (size === 1) throw error;
        rejectedBatches.push(String(error));
        fallbacks++;
        size = 1;
        began = performance.now();
        built = await build();
      }
      metrics(built.signed, "send", performance.now() - began, size);
      await built.signed.submit();
      f.emulator.awaitBlock();
      packets.push(...built.batch.packets);
      offset += size;
    }
    if (Deno.env.get("PACKET_LANE_REQUIRE_PAIR_BATCHES") === "1") {
      assertEquals(
        fallbacks,
        0,
        "two-request batches regressed to single sends",
      );
      assert(
        phases.every((tx) => Number(tx.memory) <= 15_500_000),
        "send batch lost its execution-memory headroom",
      );
    }
    assertEquals(
      packets.map((p) => p.fields[0]),
      Array.from({ length: scenario.requests }, (_, i) => BigInt(i + 1)),
    );
    result.send = {
      milliseconds: performance.now() - sendStart,
      inclusionRounds: phases.length,
      fallbacks,
      rejectedBatches,
      sentBeforeAnyAcknowledgement: packets.length,
    };
    let acknowledgementStart = performance.now();
    const prepare = async (
      packet: Constr<Data>,
      suppliedWallet?: Awaited<ReturnType<typeof f.wallet>>,
      phase = "acknowledgement",
    ) => {
      const wallet = suppliedWallet ?? await f.wallet();
      const proof = f.proofs.get(packet.fields[0] as bigint)!;
      const began = performance.now();
      const ack = await buildPacketAcknowledgement(
        wallet,
        f.deployment,
        packet,
        proof.height,
        proof.proof,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
      const signed = await signMeasured(
        wallet,
        ack.tx,
        `ack ${packet.fields[0]}`,
      );
      metrics(signed, phase, performance.now() - began);
      return {
        packet,
        signed,
        laneInput: `${ack.input.txHash}#${ack.input.outputIndex}`,
      };
    };
    if (scenario.requests === 5 && scenario.lanes === 16) {
      const restore = snapshot(f);
      const sharedWallet = await f.wallet();
      const first = await prepare(
        packets[0],
        sharedWallet,
        "shared-fee-wallet-probe",
      );
      const second = await prepare(
        packets[1],
        sharedWallet,
        "shared-fee-wallet-probe",
      );
      assert(first.laneInput !== second.laneInput);
      const refs = (tx: typeof first) => {
        const inputs = tx.signed.toTransaction().body().inputs();
        return Array.from(
          { length: inputs.len() },
          (_, i) =>
            `${inputs.get(i).transaction_id().to_hex()}#${
              inputs.get(i).index()
            }`,
        );
      };
      const sharedInputs = refs(first).filter((ref) =>
        refs(second).includes(ref)
      );
      assert(
        sharedInputs.length > 0,
        "fee-wallet probe must actually share a spending input",
      );
      await first.signed.submit();
      f.emulator.awaitBlock();
      let rejected = false;
      try {
        await second.signed.submit();
      } catch {
        rejected = true;
      }
      assert(rejected, "shared fee input double spend unexpectedly succeeded");
      result.sharedFeeWalletProbe = {
        distinctLaneInputs: true,
        sharedSpendingInputs: sharedInputs.length,
        secondTransactionRejected: rejected,
      };
      restore();
      acknowledgementStart = performance.now();
    }
    // Build every completion from one snapshot, then exercise stale-spend rejection.
    const prepared = [];
    for (const packet of packets) prepared.push(await prepare(packet));
    const groups = new Map<string, typeof prepared>();
    for (const tx of prepared) {
      groups.set(tx.laneInput, [...(groups.get(tx.laneInput) ?? []), tx]);
    }
    let conflicts = 0;
    const retries: Constr<Data>[][] = [];
    for (const group of groups.values()) {
      await group[0].signed.submit();
      for (const stale of group.slice(1)) {
        let rejected = false;
        try {
          await stale.signed.submit();
        } catch {
          rejected = true;
        }
        assert(rejected, "same-lane double spend unexpectedly succeeded");
        conflicts++;
      }
      retries.push(group.slice(1).map((tx) => tx.packet));
    }
    f.emulator.awaitBlock();
    let rounds = 1;
    while (retries.some((queue) => queue.length)) {
      const next = [];
      for (const queue of retries) {
        if (queue.length) next.push(await prepare(queue.shift()!));
      }
      for (const tx of next) await tx.signed.submit();
      f.emulator.awaitBlock();
      rounds++;
    }
    result.acknowledgement = {
      milliseconds: performance.now() - acknowledgementStart,
      initiallyIndependent: groups.size,
      staleRejections: conflicts,
      inclusionRounds: rounds,
      completed: packets.length,
    };
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = String(error);
    console.error(error);
  }
  result.totalMilliseconds = performance.now() - start;
  await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, transactions: undefined }));
}
console.log(`Report: ${output}`);
if (results.some((result) => result.status !== "passed")) Deno.exit(1);
