import {
  ConsensusHistoryCommitment,
  recordFromConstr,
} from "./consensus_history_commitment.ts";
import { readValidator } from "./utils.ts";
import { membershipProof } from "./testing/channel-fixture.ts";
import { absenceProof } from "./testing/packet-budget-fixture.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  applyDoubleCborEncoding,
  CML,
  type Constr,
  credentialToAddress,
  Data,
  fromText,
  getAddressDetails,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  buildLiquidityRetirement,
  buildPacketAcknowledgement,
  buildPacketBalanceCompaction,
  buildPacketPrune,
  buildPacketReceive,
  buildPacketRejection,
  buildPacketSendBatch,
  buildPacketTimeout,
  buildPacketTimeoutOnClose,
  buildTransferIntent,
  buildTransferIntentCancellation,
  encode,
  record,
  selectPacketLiquidity,
  sha256,
  variant,
  voucherTokenName,
} from "./packet-lane-transactions.ts";
import {
  packetLaneFixture,
  signMeasured,
  snapshot,
} from "./testing/packet-lane-fixture.ts";

const scriptFailureMessage = Deno.env.get("PACKET_LANE_NODE_URL")
  ? "validator"
  : "failed script execution";

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
    scriptFailureMessage,
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
  const genuine = (await wallet.utxosAt(f.deployment.batchAddress))[0];
  const counterfeit = Data.from(genuine.datum!) as Constr<Data>;
  f.seed(
    f.deployment.batchAddress,
    { lovelace: 10_000_000n },
    encode(counterfeit),
  );
  const underfunded = Data.from(genuine.datum!) as Constr<Data>;
  underfunded.fields[6] = 100_000_000n;
  f.seed(
    f.deployment.batchAddress,
    { lovelace: 1_000_000n },
    encode(underfunded),
  );
  // Even a candidate claiming the genuine NFT must back its declared principal.
  assertEquals(
    selectPacketLiquidity(
      [
        { ...genuine, datum: encode(underfunded) },
        genuine,
      ],
      f.deployment,
      "transfer",
      "channel-0",
      fromText("lovelace"),
      2_000_000n,
      1n,
    ),
    [genuine],
  );
  const malformed = Data.from(genuine.datum!) as Constr<Data>;
  malformed.fields[0] = record(1n);
  f.seed(
    f.deployment.batchAddress,
    { lovelace: 10_000_000n },
    encode(malformed),
  );
  for (
    const mutate of [
      (datum: Constr<Data>) => {
        datum.index = 1;
      },
      (datum: Constr<Data>) => {
        datum.fields[5] = record("ff", -1n);
      },
      (datum: Constr<Data>) => {
        datum.fields[5] = 42n;
      },
      (datum: Constr<Data>) => {
        datum.fields[6] = "10";
      },
      (datum: Constr<Data>) => {
        datum.fields[7] = record(record(1n), variant(1));
      },
      (datum: Constr<Data>) => {
        datum.fields[4] = "ab";
      },
    ]
  ) {
    const invalid = Data.from(genuine.datum!) as Constr<Data>;
    mutate(invalid);
    assertEquals(
      selectPacketLiquidity(
        [
          { ...genuine, datum: encode(invalid) },
          genuine,
        ],
        f.deployment,
        "transfer",
        "channel-0",
        fromText("lovelace"),
        2_000_000n,
        1n,
      ),
      [genuine],
    );
  }
  const candidates = await wallet.utxosAt(f.deployment.batchAddress);
  // The untrusted outputs are deliberately ahead of the genuine deposit.
  const inputs = selectPacketLiquidity(
    candidates.filter((u) => u.txHash !== genuine.txHash).concat(genuine),
    f.deployment,
    "transfer",
    "channel-0",
    fromText("lovelace"),
    2_000_000n,
    1n,
  );
  assertEquals(inputs, [genuine]);
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
    scriptFailureMessage,
  );
  await signed.submit();
  f.emulator.awaitBlock();
  assertEquals((await wallet.utxosAt(f.deployment.batchAddress)).length, 3);
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
  mutate: (operation: Constr<Data>, authorized: Constr<Data>) => void,
): string {
  const witnesses = transaction.witness_set();
  const original = witnesses.redeemers()!.to_flat_format();
  const redeemers = CML.MapRedeemerKeyToRedeemerVal.new();
  let found = false;
  for (let i = 0; i < original.len(); i++) {
    const redeemer = original.get(i);
    const data = Data.from(redeemer.data().to_cbor_hex()) as Constr<Data>;
    if (redeemer.tag() === CML.RedeemerTag.Mint && data.fields?.length === 3) {
      mutate(data.fields[1] as Constr<Data>, data);
      found = true;
    }
    redeemers.insert(
      CML.RedeemerKey.new(redeemer.tag(), redeemer.index()),
      CML.RedeemerVal.new(
        CML.PlutusData.from_cbor_hex(encode(data)),
        redeemer.ex_units(),
      ),
    );
  }
  assert(found);
  witnesses.set_redeemers(
    CML.Redeemers.new_map_redeemer_key_to_redeemer_val(redeemers),
  );
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

Deno.test("returning native packets partially release then retire a deposit with independent receipt proofs", async () => {
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
  await (await signMeasured(wallet, batch.tx, "return deposit")).submit();
  f.emulator.awaitBlock();
  const receiver =
    getAddressDetails(await wallet.wallet().address()).paymentCredential!.hash;
  for (let sequence = 1n; sequence <= 2n; sequence++) {
    const timeout = BigInt(f.emulator.now() + 3_600_000) * 1_000_000n;
    const payload = fromText(
      JSON.stringify({
        denom: `transfer/channel-7/${fromText("lovelace")}`,
        amount: "1000000",
        sender: "cosmos1sender",
        receiver,
        memo: "",
      }),
    );
    const packet = record(
      sequence,
      fromText("transfer"),
      fromText("channel-7"),
      fromText("transfer"),
      fromText("channel-0"),
      payload,
      record(0n, 0n),
      timeout,
    );
    const commitment = await sha256(
      timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
        await sha256(payload),
    );
    const proof = await membershipProof(
      fromText(
        `commitments/ports/transfer/channels/channel-7/sequences/${sequence}`,
      ),
      commitment,
    );
    const height = record(1n, 18n + sequence);
    checkpoint(f, height, proof.root);
    const inputs = await wallet.utxosAt(f.deployment.batchAddress);
    const received = await buildPacketReceive(
      wallet,
      f.deployment,
      packet,
      height,
      proof.proof,
      inputs,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    const signed = await signMeasured(
      wallet,
      received.tx,
      sequence === 1n ? "partial native receive" : "full-drain native receive",
    );
    const corrupted = changeMintRedeemer(
      signed.toTransaction(),
      (operation) => {
        (operation.fields[1] as Constr<Data>).fields[3] = fromText(
          "11".repeat(28),
        );
      },
    );
    await assertRejects(
      () => f.emulator.evaluateTx(corrupted),
      Error,
      scriptFailureMessage,
    );
    await signed.submit();
    f.emulator.awaitBlock();
    const remaining = await wallet.utxosAt(f.deployment.batchAddress);
    assertEquals(remaining.length, sequence === 1n ? 1 : 0);
    if (remaining.length) {
      assertEquals(
        (Data.from(remaining[0].datum!) as Constr<Data>).fields[6],
        1_000_000n,
      );
    }
    await assertRejects(
      () =>
        buildPacketReceive(
          wallet,
          f.deployment,
          packet,
          height,
          proof.proof,
          remaining,
          f.emulator.now(),
          f.emulator.now() + 60_000,
        ),
      Error,
      "already received",
    );
  }
});

Deno.test("an authenticated error acknowledgement refunds principal and retires its deposit", async () => {
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
  await (await signMeasured(wallet, batch.tx, "rejected deposit")).submit();
  f.emulator.awaitBlock();
  const rejection = "receiver rejected transfer";
  const proof = await membershipProof(
    fromText("acks/ports/transfer/channels/channel-7/sequences/1"),
    await sha256(fromText(JSON.stringify({ error: rejection }))),
  );
  const height = record(1n, 19n);
  checkpoint(f, height, proof.root);
  const inputs = await wallet.utxosAt(f.deployment.batchAddress);
  const refund = await buildPacketRejection(
    wallet,
    f.deployment,
    batch.packets[0],
    height,
    proof.proof,
    inputs,
    rejection,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await (await signMeasured(wallet, refund.tx, "error acknowledgement refund"))
    .submit();
  f.emulator.awaitBlock();
  assertEquals((await wallet.utxosAt(f.deployment.batchAddress)).length, 0);
});

function checkpoint(
  f: Awaited<ReturnType<typeof packetLaneFixture>>,
  height: Constr<Data>,
  root: string,
) {
  const client = Data.from(f.deployment.client.datum!) as Constr<Data>;
  const state = client.fields[0] as Constr<Data>;
  (state.fields[0] as Constr<Data>).fields[6] = height;
  state.fields[1] = new Map([[
    height,
    record(
      BigInt(f.emulator.now()) * 1_000_000n,
      "00".repeat(32),
      record(root),
    ),
  ]]);
  state.fields[2] = new Map([[height, 0n]]);
  state.fields[3] = new Map([[height, 0n]]);
  f.deployment.client.datum = encode(client);
}

for (const firstSeen of [false, true]) {
  Deno.test(`${firstSeen ? "first-seen" : "existing"} vouchers receive through packet lanes then burn on a funded return batch`, async () => {
    const f = await packetLaneFixture();
    const wallet = await f.wallet(true);
    const receiver =
      getAddressDetails(await wallet.wallet().address()).paymentCredential!
        .hash;
    const fullDenom = "transfer/channel-0/uatom";
    const token = voucherTokenName(fullDenom);
    const unit = f.deployment.voucherPolicy! + token;
    const metadata = record(
      new Map([
        [fromText("name"), fromText("uatom")],
        [fromText("ticker"), fromText("uatom")],
        [fromText("description"), fromText(`IBC voucher for ${fullDenom}`)],
      ]),
      1n,
      new Map<Data, Data>([
        [fromText("path"), fromText("transfer/channel-0")],
        [fromText("baseDenom"), fromText("uatom")],
        [fromText("fullDenom"), fromText(fullDenom)],
        [fromText("ibcDenomHash"), fromText(await sha256(fromText(fullDenom)))],
        [fromText("traceVersion"), 1n],
        [fromText("voucherPolicyId"), fromText(f.deployment.voucherPolicy!)],
        [fromText("voucherTokenName"), fromText(token)],
      ]),
    );
    let registration: {
      directory: UTxO;
      shard: UTxO;
      reference: UTxO;
      address: string;
      updated: string;
      redeemer: string;
    } | undefined;
    if (!firstSeen) {
      f.deployment.scripts.push(
        f.seed(
          credentialToAddress("Custom", {
            type: "Script",
            hash: f.metadataHash,
          }),
          {
            lovelace: 5_000_000n,
            [f.deployment.voucherPolicy! + "000643b0" + token.slice(8)]: 1n,
          },
          encode(metadata),
        ),
      );
    } else {
      const policy = "94".repeat(28);
      const [script, , address] = readValidator(
        "trace_registry.spend_trace_registry.spend",
        wallet,
        [
          policy,
          record(policy, "02"),
          f.deployment.voucherPolicy!,
          "",
          "93".repeat(28),
        ],
      );
      const bucket = parseInt(token.slice(8, 9), 16);
      const name = (index: number) => fromText(`shard-${index}`);
      const directory = f.seed(
        address,
        { lovelace: 10_000_000n, [policy + "02"]: 1n },
        encode(variant(
          1,
          record(
            Array.from(
              { length: 16 },
              (_, index) => record(BigInt(index), name(index), []),
            ),
          ),
        )),
      );
      const shard = f.seed(address, {
        lovelace: 10_000_000n,
        [policy + name(bucket)]: 1n,
      }, encode(variant(0, record(BigInt(bucket), []))));
      const reference = f.seed(
        address,
        { lovelace: 100_000_000n },
        Data.void(),
        { ...script, script: applyDoubleCborEncoding(script.script) },
      );
      registration = {
        directory,
        shard,
        reference,
        address,
        updated: encode(
          variant(
            0,
            record(BigInt(bucket), [
              record(token.slice(8), fromText(fullDenom)),
            ]),
          ),
        ),
        redeemer: encode(variant(0, token.slice(8), fromText(fullDenom))),
      };
    }
    const timeout = BigInt(f.emulator.now() + 3_600_000) * 1_000_000n;
    const payload = fromText(
      JSON.stringify({
        denom: "uatom",
        amount: "1000",
        sender: "cosmos1sender",
        receiver,
        memo: "",
      }),
    );
    const packet = record(
      1n,
      fromText("transfer"),
      fromText("channel-7"),
      fromText("transfer"),
      fromText("channel-0"),
      payload,
      record(0n, 0n),
      timeout,
    );
    const commitment = await sha256(
      timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
        await sha256(payload),
    );
    const proof = await membershipProof(
      fromText("commitments/ports/transfer/channels/channel-7/sequences/1"),
      commitment,
    );
    const height = record(1n, 19n);
    checkpoint(f, height, proof.root);
    const receive = await buildPacketReceive(
      wallet,
      f.deployment,
      packet,
      height,
      proof.proof,
      [],
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    if (registration) {
      receive.tx.readFrom([registration.directory, registration.reference])
        .collectFrom([registration.shard], registration.redeemer)
        .pay.ToContract(registration.address, {
          kind: "inline",
          value: registration.updated,
        }, registration.shard.assets)
        .mintAssets({
          [f.deployment.voucherPolicy! + "000643b0" + token.slice(8)]: 1n,
        }, encode(variant(4)))
        .pay.ToContract(
          credentialToAddress("Custom", {
            type: "Script",
            hash: f.metadataHash,
          }),
          { kind: "inline", value: encode(metadata) },
          { [f.deployment.voucherPolicy! + "000643b0" + token.slice(8)]: 1n },
        );
    }
    await (await signMeasured(wallet, receive.tx, "voucher receive")).submit();
    f.emulator.awaitBlock();
    assertEquals(
      (await wallet.wallet().getUtxos()).reduce(
        (sum, u) => sum + (u.assets[unit] ?? 0n),
        0n,
      ),
      1000n,
    );
    const admission = await buildTransferIntent(wallet, f.deployment, {
      amount: 1000n,
      assetUnit: unit,
      fullDenom,
      receiver: "cosmos1receiver",
      timeoutTimestamp: timeout,
    });
    const intentHash =
      await (await (await admission.complete()).sign.withWallet().complete())
        .submit();
    f.emulator.awaitBlock();
    const intents = (await wallet.utxosAt(f.deployment.guardAddress)).filter(
      (u) => u.txHash === intentHash,
    );
    const batch = await buildPacketSendBatch(
      wallet,
      f.deployment,
      intents,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, batch.tx, "voucher return burn"))
      .submit();
    f.emulator.awaitBlock();
    assertEquals(
      (await wallet.wallet().getUtxos()).reduce(
        (sum, u) => sum + (u.assets[unit] ?? 0n),
        0n,
      ),
      0n,
    );
    assertEquals((await wallet.utxosAt(f.deployment.batchAddress)).length, 0);
    const absent = await absenceProof(
      fromText("commitments/ports/transfer/channels/channel-7/sequences/1"),
    );
    const pruningHeight = record(1n, 20n);
    checkpoint(f, pruningHeight, absent.root);
    const prune = await buildPacketPrune(
      wallet,
      f.deployment,
      1n,
      pruningHeight,
      absent.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, prune.tx, "packet lane pruning"))
      .submit();
    f.emulator.awaitBlock();
    const laneUnit = Object.keys(prune.input.assets).find((unit) =>
      unit.startsWith(f.deployment.statePolicy)
    )!;
    const lane = Data.from(
      (await wallet.utxoByUnit(laneUnit)).datum!,
    ) as Constr<Data>;
    assertEquals(lane.fields[7], []);
    assertEquals(lane.fields[8], new Map());
    assertEquals(lane.fields[9], pruningHeight);
  });
}

Deno.test("an acknowledgement authenticates an older consensus checkpoint against the current client history", async () => {
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
  await (await signMeasured(wallet, batch.tx, "history deposit")).submit();
  f.emulator.awaitBlock();
  const proof = f.proofs.get(1n)!;
  const client = Data.from(f.deployment.client.datum!) as Constr<Data>;
  const state = client.fields[0] as Constr<Data>;
  const old =
    [...(state.fields[1] as Map<Constr<Data>, Data>)].find(([h]) =>
      encode(h) === encode(proof.height)
    )![1];
  const saved = record(client.fields[1], proof.height, old, 0n, 0n);
  const item = recordFromConstr(saved);
  const history = new ConsensusHistoryCommitment();
  history.append(item);
  client.fields[2] = await history.getRoot();
  f.deployment.client.datum = encode(client);
  checkpoint(f, record(1n, 19n), "a1".repeat(32));
  const witness = await history.witness(item.clientToken, item.height);
  f.deployment.historyWitness = record(saved, witness.siblings);
  const ack = await buildPacketAcknowledgement(
    wallet,
    f.deployment,
    batch.packets[0],
    proof.height,
    proof.proof,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  const signed = await signMeasured(
    wallet,
    ack.tx,
    "historical acknowledgement",
  );
  const invalid = changeMintRedeemer(
    signed.toTransaction(),
    (_, authorized) => {
      const history = (authorized.fields[2] as Constr<Data>)
        .fields[0] as Constr<Data>;
      (history.fields[1] as string[])[0] = "ff".repeat(32);
    },
  );
  await assertRejects(
    () => f.emulator.evaluateTx(invalid),
    Error,
    scriptFailureMessage,
  );
  // A correct historical proof is usable after the client has advanced.
  await signed.submit();
  f.emulator.awaitBlock();
  assertEquals((await wallet.utxosByOutRef([ack.input])).length, 0);
});

Deno.test("timeout on close proves closure and receipt absence at the same authenticated height", async () => {
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
  await (await signMeasured(wallet, batch.tx, "close-timeout deposit"))
    .submit();
  f.emulator.awaitBlock();
  const connection = (Data.from(f.deployment.connection.datum!) as Constr<Data>)
    .fields[0] as Constr<Data>;
  const remoteConnection = String(
    (connection.fields[3] as Constr<Data>).fields[1],
  );
  const bytes = (field: number, hex: string) =>
    (field * 8 + 2).toString(16).padStart(2, "0") +
    (hex.length / 2).toString(16).padStart(2, "0") + hex;
  const closed = "08041001" +
    bytes(3, bytes(1, fromText("transfer")) + bytes(2, fromText("channel-0"))) +
    bytes(4, remoteConnection) + bytes(5, fromText("ics20-1"));
  const membership = await membershipProof(
    fromText("channelEnds/ports/transfer/channels/channel-7"),
    closed,
  );
  const layers = membership.proof.fields[0] as Constr<Data>[];
  const left = (layers[0].fields[0] as Constr<Data>).fields[0];
  const empty = record("", "", record(0n, 0n, 0n, 0n, ""), []);
  const absence = record([
    record(
      variant(
        1,
        record(
          fromText("receipts/ports/transfer/channels/channel-7/sequences/1"),
          left,
          empty,
        ),
      ),
    ),
    layers[1],
  ]);
  const height = record(1n, 19n);
  checkpoint(f, height, membership.root);
  // The timestamp has not elapsed. Only the authenticated closed channel permits refund.
  const liquidity = await wallet.utxosAt(f.deployment.batchAddress);
  const refund = await buildPacketTimeoutOnClose(
    wallet,
    f.deployment,
    batch.packets[0],
    height,
    absence,
    membership.proof,
    liquidity,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  const signed = await signMeasured(wallet, refund.tx, "timeout on close");
  await signed.submit();
  f.emulator.awaitBlock();
  assertEquals((await wallet.utxosAt(f.deployment.batchAddress)).length, 0);
});

Deno.test("repeated multi-asset round trips reclaim full accounting maps across different lanes", async () => {
  const f = await packetLaneFixture(2);
  const wallet = await f.wallet();
  const address = await wallet.wallet().address();
  const receiver = getAddressDetails(address).paymentCredential!.hash;
  const sizes: number[] = [];
  for (let index = 0; index < 24; index++) {
    const unit = "aa".repeat(28) + index.toString(16).padStart(2, "0");
    f.seed(address, { lovelace: 5_000_000n, [unit]: 10n }, Data.void());
    const timeout = BigInt(f.emulator.now() + 3_600_000) * 1_000_000n;
    const admission = await buildTransferIntent(wallet, f.deployment, {
      assetUnit: unit,
      amount: 10n,
      receiver: "cosmos1receiver",
      timeoutTimestamp: timeout,
    });
    const admitted =
      await (await (await admission.complete()).sign.withWallet().complete())
        .submit();
    f.emulator.awaitBlock();
    const intents = (await wallet.utxosAt(f.deployment.guardAddress)).filter((
      u,
    ) => u.txHash === admitted);
    const send = await buildPacketSendBatch(
      wallet,
      f.deployment,
      intents,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, send.tx, `asset ${index} send`)).submit();
    f.emulator.awaitBlock();
    const packet = send.packets[0];
    const sequence = packet.fields[0] as bigint;
    const ackProof = await membershipProof(
      fromText(`acks/ports/transfer/channels/channel-7/sequences/${sequence}`),
      await sha256(fromText('{"result":"AQ=="}')),
    );
    const ackHeight = record(1n, 100n + BigInt(index) * 3n);
    checkpoint(f, ackHeight, ackProof.root);
    const ack = await buildPacketAcknowledgement(
      wallet,
      f.deployment,
      packet,
      ackHeight,
      ackProof.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, ack.tx, `asset ${index} acknowledgement`))
      .submit();
    f.emulator.awaitBlock();
    const remoteSequence = sequence + 1n;
    const payload = fromText(
      JSON.stringify({
        denom: `transfer/channel-7/${unit}`,
        amount: "10",
        sender: "cosmos1sender",
        receiver,
        memo: "",
      }),
    );
    const returning = record(
      remoteSequence,
      fromText("transfer"),
      fromText("channel-7"),
      fromText("transfer"),
      fromText("channel-0"),
      payload,
      record(0n, 0n),
      timeout,
    );
    const proof = await membershipProof(
      fromText(
        `commitments/ports/transfer/channels/channel-7/sequences/${remoteSequence}`,
      ),
      await sha256(
        timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
          await sha256(payload),
      ),
    );
    const receiveHeight = record(1n, 101n + BigInt(index) * 3n);
    checkpoint(f, receiveHeight, proof.root);
    const liquidity = selectPacketLiquidity(
      await wallet.utxosAt(f.deployment.batchAddress),
      f.deployment,
      "transfer",
      "channel-0",
      unit,
      10n,
      remoteSequence,
    );
    const receive = await buildPacketReceive(
      wallet,
      f.deployment,
      returning,
      receiveHeight,
      proof.proof,
      liquidity,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, receive.tx, `asset ${index} return`))
      .submit();
    f.emulator.awaitBlock();
    const absent = await absenceProof(
      fromText(
        `commitments/ports/transfer/channels/channel-7/sequences/${remoteSequence}`,
      ),
    );
    const pruneHeight = record(1n, 102n + BigInt(index) * 3n);
    checkpoint(f, pruneHeight, absent.root);
    const prune = await buildPacketPrune(
      wallet,
      f.deployment,
      remoteSequence,
      pruneHeight,
      absent.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, prune.tx, `asset ${index} prune`))
      .submit();
    f.emulator.awaitBlock();
    const returned = await wallet.utxosAt(
      credentialToAddress("Custom", { type: "Key", hash: receiver }),
    );
    assertEquals(
      returned.reduce((sum, input) => sum + (input.assets[unit] ?? 0n), 0n),
      10n,
    );
    if ((index + 1) % 8 === 0) {
      const compact = await buildPacketBalanceCompaction(
        wallet,
        f.deployment,
        0,
        1,
      );
      for (const input of compact.inputs) {
        const old = Data.from(input.datum!) as Constr<Data>;
        assertEquals((old.fields[11] as Map<Data, Data>).size, 8);
        assertEquals((old.fields[6] as Map<Data, Data>).size, 0);
        assertEquals(old.fields[7], []);
        assertEquals((old.fields[8] as Map<Data, Data>).size, 0);
      }
      const signed = await signMeasured(
        wallet,
        compact.tx,
        `full accounting compaction ${index}`,
      );
      sizes.push(signed.toCBOR().length / 2);
      await signed.submit();
      f.emulator.awaitBlock();
      for (const datum of compact.datums) {
        assertEquals((datum.fields[11] as Map<Data, Data>).size, 0);
      }
      await assertRejects(() => signed.submit());
    }
  }
  assertEquals((await wallet.utxosAt(f.deployment.batchAddress)).length, 0);
  assert(
    Math.max(...sizes) - Math.min(...sizes) < 128,
    "maintenance size must not grow with historical assets",
  );
});

Deno.test("full accounting maps can swap assets while preserving pending packets within ledger budgets", async () => {
  const f = await packetLaneFixture(2);
  const wallet = await f.wallet();
  const address = await wallet.wallet().address();
  const leftDenoms: string[] = [];
  for (let index = 0; index < 16; index++) {
    const unit = "bb".repeat(28) + index.toString(16).padStart(2, "0");
    if (index % 2 === 0) leftDenoms.push(unit);
    f.seed(address, { lovelace: 5_000_000n, [unit]: 10n }, Data.void());
    const admission = await buildTransferIntent(wallet, f.deployment, {
      assetUnit: unit,
      amount: 10n,
      receiver: "cosmos1receiver",
      timeoutTimestamp: BigInt(f.emulator.now() + 3_600_000) * 1_000_000n,
    });
    const admitted =
      await (await (await admission.complete()).sign.withWallet().complete())
        .submit();
    f.emulator.awaitBlock();
    const intents = (await wallet.utxosAt(f.deployment.guardAddress)).filter((
      u,
    ) => u.txHash === admitted);
    const send = await buildPacketSendBatch(
      wallet,
      f.deployment,
      intents,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, send.tx, `full-map send ${index}`))
      .submit();
    f.emulator.awaitBlock();
  }
  const compact = await buildPacketBalanceCompaction(
    wallet,
    f.deployment,
    0,
    1,
    leftDenoms,
  );
  const old = compact.inputs.map((input) =>
    Data.from(input.datum!) as Constr<Data>
  );
  for (const [index, datum] of compact.datums.entries()) {
    assertEquals((datum.fields[11] as Map<Data, Data>).size, 8);
    assertEquals(datum.fields[11], old[1 - index].fields[11]);
    assertEquals(datum.fields.slice(5, 11), old[index].fields.slice(5, 11));
    assertEquals((datum.fields[6] as Map<Data, Data>).size, 8);
  }
  await (await signMeasured(wallet, compact.tx, "full-map redistribution"))
    .submit();
  f.emulator.awaitBlock();
});
