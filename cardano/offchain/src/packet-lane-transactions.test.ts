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
  type LucidEvolution,
  type TxSigned,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  buildLiquidityRetirement,
  buildPacketAcknowledgement,
  buildPacketAcknowledgementBatch,
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
  PacketLaneAccountingCapacityError,
  PacketLaneHistory,
  record,
  selectPacketLiquidity,
  sha256,
  variant,
  voucherTokenName,
} from "./packet-lane-transactions.ts";
import {
  packetLaneFixture,
  signMeasured as signFixtureMeasured,
  snapshot,
} from "./testing/packet-lane-fixture.ts";

const scriptFailureMessage = Deno.env.get("PACKET_LANE_NODE_URL")
  ? "validator"
  : "failed script execution";

async function resolveInputs(
  lucid: LucidEvolution,
  inputs: CML.TransactionInputList | undefined,
) {
  const refs = [];
  for (let i = 0; inputs && i < inputs.len(); i++) {
    refs.push({
      txHash: inputs.get(i).transaction_id().to_hex(),
      outputIndex: Number(inputs.get(i).index()),
    });
  }
  const resolved = await lucid.utxosByOutRef(refs);
  assertEquals(resolved.length, refs.length);
  return resolved;
}

// Derive the needed identities from the final transaction, independently of
// the builder's operation-to-reference selection.
async function signMeasured(...args: Parameters<typeof signFixtureMeasured>) {
  const signed = await signFixtureMeasured(...args);
  const lucid = args[0], body = signed.toTransaction().body();
  const required = new Set<string>();
  for (const input of await resolveInputs(lucid, body.inputs())) {
    const credential = getAddressDetails(input.address).paymentCredential;
    if (credential?.type === "Script") required.add(credential.hash);
  }
  const mint = body.mint()?.keys();
  for (let i = 0; mint && i < mint.len(); i++) {
    required.add(mint.get(i).to_hex());
  }
  for (const reference of await resolveInputs(lucid, body.reference_inputs())) {
    if (
      !reference.scriptRef ||
      Object.entries(reference.assets).some(([unit, amount]) =>
        unit !== "lovelace" && amount !== 0n
      )
    ) continue;
    const hash = validatorToScriptHash(reference.scriptRef);
    assert(
      required.has(hash),
      `${args[2]} carries unused reference script ${hash}`,
    );
  }
  return signed;
}

async function submitReconciled(
  fixture: Awaited<ReturnType<typeof packetLaneFixture>>,
  lucid: LucidEvolution,
  signed: TxSigned,
) {
  const credential = getAddressDetails(await lucid.wallet().address())
    .paymentCredential!;
  const owns = (address: string) => {
    const owner = getAddressDetails(address).paymentCredential;
    return owner?.type === credential.type && owner.hash === credential.hash;
  };
  const balances = async () => {
    const totals: Record<string, bigint> = {};
    for (const utxo of await lucid.config().provider!.getUtxos(credential)) {
      for (const [unit, amount] of Object.entries(utxo.assets)) {
        totals[unit] = (totals[unit] ?? 0n) + amount;
      }
    }
    return totals;
  };
  const beforeAssets = await balances();
  const before = beforeAssets.lovelace;
  const body = signed.toTransaction().body();
  const inputs = await resolveInputs(lucid, body.inputs());
  let totalOutput = 0n, walletOutput = 0n;
  const protectedOutputs = [];
  for (let i = 0; i < body.outputs().len(); i++) {
    const output = body.outputs().get(i);
    assert(
      output.amount().coin() >=
        CML.min_ada_required(
          output,
          lucid.config().protocolParameters!.coinsPerUtxoByte,
        ),
    );
    totalOutput += output.amount().coin();
    const wallet = owns(output.address().to_bech32());
    if (wallet) walletOutput += output.amount().coin();
    if (
      !wallet || output.datum()
    ) protectedOutputs.push(output.to_cbor_hex());
  }
  assertEquals(
    inputs.reduce((n, u) => n + u.assets.lovelace, 0n),
    totalOutput + body.fee(),
  );
  const expectedDebit = inputs.filter((u) => owns(u.address)).reduce(
    (n, u) => n + u.assets.lovelace,
    0n,
  ) - walletOutput;
  await signed.submit();
  fixture.emulator.awaitBlock();
  const afterAssets = await balances();
  const walletDebit = before - afterAssets.lovelace;
  assertEquals(walletDebit, expectedDebit);
  // Change can carry operation tokens. Compare its net token effect without
  // requiring the ADA change amount or coin selection to stay the same.
  const walletAssetChanges = Object.fromEntries(
    [...new Set([...Object.keys(beforeAssets), ...Object.keys(afterAssets)])]
      .filter((unit) => unit !== "lovelace").sort()
      .map((
        unit,
      ) => [unit, (afterAssets[unit] ?? 0n) - (beforeAssets[unit] ?? 0n)]),
  );
  return {
    transaction: signed.toHash(),
    fee: body.fee(),
    walletDebit,
    walletAssetChanges,
    protectedOutputs: protectedOutputs.sort(),
  };
}

function reportReferenceFees(
  profile: string,
  control: bigint,
  reduced: bigint,
) {
  assert(control > reduced, `${profile} must reduce fees`);
  console.log(
    "packet-reference-fees " +
      JSON.stringify({
        profile,
        controlFeeLovelace: control.toString(),
        reducedFeeLovelace: reduced.toString(),
        savingLovelace: (control - reduced).toString(),
      }),
  );
}

Deno.test("native ADA send and acknowledgement omit unused references with reconciled cold fee savings", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(1);
  const wallet = await f.wallet(true);
  // Array order must not determine script selection.
  f.deployment.scripts.reverse();
  const extra = f.deployment.scripts.filter((u) =>
    u.scriptRef &&
    [f.deployment.statePolicy, f.deployment.voucherPolicy].includes(
      validatorToScriptHash(u.scriptRef),
    )
  );
  assertEquals(extra.length, 2);
  const restore = snapshot(f);
  const run = async (control: boolean) => {
    const sign = control ? signFixtureMeasured : signMeasured;
    const batch = await buildPacketSendBatch(
      wallet,
      f.deployment,
      intents,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    if (control) batch.tx.readFrom(extra);
    const sent = await submitReconciled(
      f,
      wallet,
      await sign(
        wallet,
        batch.tx,
        control ? "full-reference send" : "minimal-reference send",
      ),
    );
    const proof = f.proofs.get(1n)!;
    const ack = await buildPacketAcknowledgement(
      wallet,
      f.deployment,
      batch.packets[0],
      proof.height,
      proof.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    if (control) ack.tx.readFrom(extra);
    const acknowledged = await submitReconciled(
      f,
      wallet,
      await sign(
        wallet,
        ack.tx,
        control
          ? "full-reference acknowledgement"
          : "minimal-reference acknowledgement",
      ),
    );
    return {
      sent,
      acknowledged,
      fee: sent.fee + acknowledged.fee,
      debit: sent.walletDebit + acknowledged.walletDebit,
    };
  };
  const control = await run(true);
  restore();
  const reduced = await run(false);
  assertEquals(reduced.sent.protectedOutputs, control.sent.protectedOutputs);
  assertEquals(
    reduced.acknowledged.protectedOutputs,
    control.acknowledged.protectedOutputs,
  );
  assertEquals(
    reduced.sent.walletAssetChanges,
    control.sent.walletAssetChanges,
  );
  assertEquals(
    reduced.acknowledged.walletAssetChanges,
    control.acknowledged.walletAssetChanges,
  );
  assertEquals(control.debit - reduced.debit, control.fee - reduced.fee);
  reportReferenceFees(
    "ADA send plus acknowledgement",
    control.fee,
    reduced.fee,
  );
});

Deno.test("forty receives on one lane retain bounded live state and rebuild delayed acknowledgement proofs", async () => {
  const f = await packetLaneFixture(1, 1);
  const { intents } = await f.admit(1);
  const wallet = await f.wallet();
  const sent = await buildPacketSendBatch(
    wallet,
    f.deployment,
    intents,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await submitReconciled(
    f,
    wallet,
    await signMeasured(wallet, sent.tx, "history deposit"),
  );
  const acknowledgement = f.proofs.get(1n)!;
  const completed = await buildPacketAcknowledgement(
    wallet,
    f.deployment,
    sent.packets[0],
    acknowledgement.height,
    acknowledgement.proof,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await submitReconciled(
    f,
    wallet,
    await signMeasured(wallet, completed.tx, "history deposit acknowledgement"),
  );
  const receiver =
    getAddressDetails(await wallet.wallet().address()).paymentCredential!.hash;
  let earliest: UTxO | undefined;
  let last:
    | { packet: Constr<Data>; proof: Constr<Data>; height: Constr<Data> }
    | undefined;
  for (let sequence = 1n; sequence <= 40n; sequence++) {
    const timeout = BigInt(f.emulator.now() + 3_600_000) * 1_000_000n;
    const payload = fromText(
      JSON.stringify({
        denom: `transfer/channel-7/${fromText("lovelace")}`,
        amount: "50000",
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
    const height = record(1n, 100n + sequence);
    checkpoint(f, height, proof.root);
    const receive = await buildPacketReceive(
      wallet,
      f.deployment,
      packet,
      height,
      proof.proof,
      await wallet.utxosAt(f.deployment.batchAddress),
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await submitReconciled(
      f,
      wallet,
      await signMeasured(wallet, receive.tx, `history receive ${sequence}`),
    );
    const unit = Object.keys(receive.input.assets).find((unit) =>
      unit.startsWith(f.deployment.statePolicy)
    )!;
    const output = await wallet.utxoByUnit(unit);
    const datum = Data.from(output.datum!) as Constr<Data>;
    assertEquals(datum.fields.length, 12);
    assertEquals(datum.fields[7], []);
    assertEquals(datum.fields[8], new Map());
    assertEquals((datum.fields[6] as Map<Data, Data>).size, 0);
    if (!earliest) earliest = output;
    assert(
      output.datum!.length <= earliest.datum!.length + 16,
      "live datum must not grow with retained receipts",
    );
    if (sequence === 32n) f.packetHistory.reset();
    last = { packet, proof: proof.proof, height };
  }
  const newest = (await wallet.utxosAt(f.deployment.guardAddress)).find(
    (output) => {
      const datum = Data.from(output.datum!) as Constr<Data>;
      return datum.fields.length === 12;
    },
  )!;
  f.packetHistory.reset();
  const tree = await f.packetHistory.resolve(f.deployment, newest);
  assertEquals(tree.tree.size(), 80);
  const ackKey = "acks/ports/transfer/channels/channel-0/sequences/1";
  const ack = await sha256(fromText('{"result":"AQ=="}'));
  assertEquals(tree.tree.generateProof(ackKey).value.toString("hex"), ack);
  const historical = await f.packetHistory.resolve(f.deployment, earliest!);
  assertEquals(historical.tree.size(), 2);
  assertEquals(
    historical.getRoot(),
    (Data.from(earliest!.datum!) as Constr<Data>).fields[5],
  );
  await assertRejects(
    () =>
      buildPacketReceive(
        wallet,
        f.deployment,
        last!.packet,
        last!.height,
        last!.proof,
        [],
        f.emulator.now(),
        f.emulator.now() + 60_000,
      ),
    Error,
    "already received",
  );
  await assertRejects(
    () =>
      buildPacketReceive(
        wallet,
        { ...f.deployment, resolveLaneTree: undefined },
        last!.packet,
        last!.height,
        last!.proof,
        [],
        f.emulator.now(),
        f.emulator.now() + 60_000,
      ),
    Error,
    "history is required",
  );
  const unit = Object.keys(newest.assets).find((unit) =>
    unit.startsWith(f.deployment.statePolicy)
  )!;
  const corrupt = new PacketLaneHistory(unit, f.deployment.batchPolicy);
  const evidence = [...f.packetHistory.transactions.values()];
  let rejected = false;
  for (const tx of evidence) {
    try {
      corrupt.apply({ ...tx, redeemers: [] });
    } catch {
      rejected = true;
      break;
    }
  }
  assert(rejected, "missing historical mutations must not produce a proof");
});

Deno.test("lazy packet references use script identity and reject missing or mismatched scripts", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(1);
  const wallet = await f.wallet();
  const scripts = f.deployment.scripts.filter((u) => u.scriptRef);
  const requested: string[][] = [];
  const deployment = {
    ...f.deployment,
    scripts: f.deployment.scripts.filter((u) => !u.scriptRef),
    resolveScriptReferences: (hashes: readonly string[]) => {
      requested.push([...hashes]);
      return Promise.resolve(
        scripts.filter((u) =>
          hashes.includes(validatorToScriptHash(u.scriptRef!))
        ).reverse(),
      );
    },
  };
  const build = (value = deployment) =>
    buildPacketSendBatch(
      wallet,
      value,
      intents,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
  const batch = await build();
  const guard =
    getAddressDetails(deployment.guardAddress).paymentCredential!.hash;
  assertEquals(requested, [[deployment.batchPolicy, guard]]);
  await assertRejects(
    () =>
      build({
        ...deployment,
        resolveScriptReferences: () => Promise.resolve([]),
      }),
    Error,
    "Missing packet reference script",
  );
  const state = scripts.find((u) =>
    validatorToScriptHash(u.scriptRef!) === deployment.statePolicy
  )!;
  await assertRejects(
    () =>
      build({
        ...deployment,
        resolveScriptReferences: () => Promise.resolve([state]),
      }),
    Error,
    "Unexpected packet reference script",
  );
  await assertRejects(
    () =>
      build({
        ...deployment,
        resolveScriptReferences: () => Promise.resolve([deployment.scripts[0]]),
      }),
    Error,
    "has no script",
  );
  await submitReconciled(
    f,
    wallet,
    await signMeasured(wallet, batch.tx, "lazy-reference send"),
  );
});

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
  for (
    const group of [packets.slice(0, 2), packets.slice(2, 4), packets.slice(4)]
  ) {
    const packet = group[0];
    const relayer = await f.wallet();
    const proof = f.proofs.get(packet.fields[0] as bigint)!;
    if (group.length === 2) {
      const batch = await buildPacketAcknowledgementBatch(
        relayer,
        f.deployment,
        group.map((packet) => {
          const proof = f.proofs.get(packet.fields[0] as bigint)!;
          return { packet, proofHeight: proof.height, proof: proof.proof };
        }),
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
      inputs.push(...batch.inputs);
      pending.push(
        await signMeasured(relayer, batch.tx, "two ready acknowledgements"),
      );
      continue;
    }
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

Deno.test("two ready acknowledgements share fees with reconciled balances and execution headroom", async () => {
  const f = await packetLaneFixture();
  const { intents } = await f.admit(2);
  let wallet = await f.wallet();
  const sent = await buildPacketSendBatch(
    wallet,
    f.deployment,
    intents,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await submitReconciled(
    f,
    wallet,
    await signMeasured(wallet, sent.tx, "ready acknowledgement source send"),
  );
  const requests = sent.packets.map((packet) => {
    const proof = f.proofs.get(packet.fields[0] as bigint)!;
    return { packet, proofHeight: proof.height, proof: proof.proof };
  });
  const restore = snapshot(f);
  let baseline = 0n;
  for (const request of requests) {
    wallet = await f.wallet();
    const built = await buildPacketAcknowledgement(
      wallet,
      f.deployment,
      request.packet,
      request.proofHeight,
      request.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    baseline += (await submitReconciled(
      f,
      wallet,
      await signMeasured(wallet, built.tx, "single ready acknowledgement"),
    )).fee;
  }
  restore();
  wallet = await f.wallet();
  await assertRejects(
    () =>
      buildPacketAcknowledgementBatch(
        wallet,
        f.deployment,
        [requests[0], requests[0]],
        f.emulator.now(),
        f.emulator.now() + 60_000,
      ),
    Error,
    "independent lanes",
  );
  const wrongProof = [requests[0], {
    ...requests[1],
    proof: requests[0].proof,
  }];
  const forged = await buildPacketAcknowledgementBatch(
    wallet,
    f.deployment,
    wrongProof,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  await assertRejects(
    () => signMeasured(wallet, forged.tx, "forged second acknowledgement"),
    Error,
  );
  wallet = await f.wallet();
  const combined = await buildPacketAcknowledgementBatch(
    wallet,
    f.deployment,
    requests,
    f.emulator.now(),
    f.emulator.now() + 60_000,
  );
  const signed = await signMeasured(
    wallet,
    combined.tx,
    "two ready acknowledgements",
  );
  const units = CML.compute_total_ex_units(
    signed.toTransaction().witness_set().redeemers()!,
  );
  const limits = wallet.config().protocolParameters!;
  assert(units.mem() * 5n <= limits.maxTxExMem * 4n);
  assert(units.steps() * 5n <= limits.maxTxExSteps * 4n);
  const reduced = await submitReconciled(f, wallet, signed);
  assert(reduced.fee < baseline);
  console.log(JSON.stringify({
    profile: "two ready successful acknowledgements",
    separateFee: baseline.toString(),
    combinedFee: reduced.fee.toString(),
    memory: units.mem().toString(),
    cpu: units.steps().toString(),
    bytes: signed.toCBOR().length / 2,
  }));
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
  Deno.test(`${firstSeen ? "first-seen" : "existing"} vouchers reserve full-channel accounting capacity through burn and refund`, async () => {
    const f = await packetLaneFixture();
    const scriptPool = f.deployment.scripts.filter((u) => u.scriptRef);
    f.deployment.scripts = f.deployment.scripts.filter((u) => !u.scriptRef);
    f.deployment.resolveScriptReferences = (hashes) =>
      Promise.resolve(
        scriptPool.filter((u) =>
          hashes.includes(validatorToScriptHash(u.scriptRef!))
        ).reverse(),
      );
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
    const buildReceive = async () => {
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
      return receive;
    };
    const receive = await buildReceive();
    const reduced = await signMeasured(
      wallet,
      receive.tx,
      "minimal-reference voucher receive",
    );
    const control = await buildReceive();
    const stateReference = scriptPool.find((u) =>
      u.scriptRef &&
      validatorToScriptHash(u.scriptRef) === f.deployment.statePolicy
    )!;
    assert(stateReference);
    control.tx.readFrom([stateReference]);
    const controlSigned = await signFixtureMeasured(
      wallet,
      control.tx,
      "full-reference voucher receive",
    );
    const restoreReceive = snapshot(f);
    const controlCosts = await submitReconciled(f, wallet, controlSigned);
    restoreReceive();
    f.deployment.client =
      (await wallet.utxosByOutRef([f.deployment.client]))[0];
    const reducedCosts = await submitReconciled(f, wallet, reduced);
    assertEquals(reducedCosts.protectedOutputs, controlCosts.protectedOutputs);
    assertEquals(
      reducedCosts.walletAssetChanges,
      controlCosts.walletAssetChanges,
    );
    assertEquals(
      controlCosts.walletDebit - reducedCosts.walletDebit,
      controlCosts.fee - reducedCosts.fee,
    );
    reportReferenceFees(
      firstSeen ? "First-seen voucher receive" : "Existing voucher receive",
      controlCosts.fee,
      reducedCosts.fee,
    );
    assertEquals(
      (await wallet.wallet().getUtxos()).reduce(
        (sum, u) => sum + (u.assets[unit] ?? 0n),
        0n,
      ),
      1000n,
    );
    // Authenticated full-channel accounting is test pre-state. The receive,
    // burn, pruning and refund below execute the compiled validators.
    let occupiedSlots = 0;
    for (const { utxo, spent } of Object.values(f.emulator.ledger)) {
      if (spent || utxo.address !== f.deployment.guardAddress || !utxo.datum) {
        continue;
      }
      const datum = Data.from(utxo.datum) as Constr<Data>;
      if (datum.fields.length !== 12) continue;
      const balances = datum.fields[11] as Map<string, bigint>;
      for (let i = balances.size; i < 8; i++) {
        balances.set(
          await sha256(fromText(`other-${datum.fields[2]}-${i}`)),
          10n,
        );
      }
      datum.fields[11] = new Map(
        [...balances].sort(([a], [b]) => a < b ? -1 : 1),
      );
      utxo.datum = encode(datum);
      occupiedSlots += balances.size;
    }
    assertEquals(occupiedSlots, 128);
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
    const restoreAcknowledgement = snapshot(f);
    const success = await membershipProof(
      fromText("acks/ports/transfer/channels/channel-7/sequences/1"),
      await sha256(fromText('{"result":"AQ=="}')),
    );
    const successHeight = record(1n, 20n);
    checkpoint(f, successHeight, success.root);
    const acknowledged = await buildPacketAcknowledgement(
      wallet,
      f.deployment,
      batch.packets[0],
      successHeight,
      success.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await submitReconciled(
      f,
      wallet,
      await signMeasured(
        wallet,
        acknowledged.tx,
        "voucher success acknowledgement without voucher policy",
      ),
    );
    restoreAcknowledgement();
    f.deployment.client =
      (await wallet.utxosByOutRef([f.deployment.client]))[0];
    const laneBefore = (await wallet.utxosAt(f.deployment.guardAddress)).find(
      (u) => {
        const datum = Data.from(u.datum!) as Constr<Data>;
        return datum.fields.length === 12 && datum.fields[2] === 1n;
      },
    )!;
    const reserved = (Data.from(laneBefore.datum!) as Constr<Data>)
      .fields[11] as Map<string, bigint>;
    assertEquals(reserved.size, 8);
    assertEquals(reserved.get(await sha256(fromText(fullDenom))), 0n);
    const newcomer = record(...packet.fields);
    newcomer.fields[0] = 17n;
    newcomer.fields[5] = fromText(
      JSON.stringify({
        denom: "new-asset",
        amount: "1",
        sender: "cosmos1sender",
        receiver,
        memo: "",
      }),
    );
    await assertRejects(
      () =>
        buildPacketReceive(
          wallet,
          f.deployment,
          newcomer,
          height,
          proof.proof,
          [],
          f.emulator.now(),
          f.emulator.now() + 60_000,
        ),
      PacketLaneAccountingCapacityError,
      "accounting is full",
    );
    await assertRejects(
      () => buildPacketBalanceCompaction(wallet, f.deployment, 1, 2),
      Error,
      "Settle outstanding sends",
    );
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
    assertEquals(
      (lane.fields[11] as Map<string, bigint>).get(
        await sha256(fromText(fullDenom)),
      ),
      0n,
    );
    const refundHeight = record(1n, 21n);
    let refund;
    if (firstSeen) {
      const err = "receiver rejected transfer";
      const rejected = await membershipProof(
        fromText("acks/ports/transfer/channels/channel-7/sequences/1"),
        await sha256(fromText(JSON.stringify({ error: err }))),
      );
      checkpoint(f, refundHeight, rejected.root);
      refund = await buildPacketRejection(
        wallet,
        f.deployment,
        batch.packets[0],
        refundHeight,
        rejected.proof,
        [],
        err,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
    } else {
      f.emulator.awaitBlock(1801);
      const missing = await absenceProof(
        fromText("receipts/ports/transfer/channels/channel-7/sequences/1"),
      );
      checkpoint(f, refundHeight, missing.root);
      refund = await buildPacketTimeout(
        wallet,
        f.deployment,
        batch.packets[0],
        refundHeight,
        missing.proof,
        [],
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
    }
    if (registration) {
      // The Gateway adds the existing CIP-68 mapping when preparing a refund.
      refund.tx.readFrom([
        await wallet.utxoByUnit(
          f.deployment.voucherPolicy! + "000643b0" + token.slice(8),
        ),
      ]);
    }
    await (await signMeasured(
      wallet,
      refund.tx,
      "full-capacity voucher refund",
    )).submit();
    f.emulator.awaitBlock();
    const refundedLane = Data.from(
      (await wallet.utxoByUnit(laneUnit)).datum!,
    ) as Constr<Data>;
    assertEquals((refundedLane.fields[11] as Map<string, bigint>).size, 8);
    assertEquals(
      (refundedLane.fields[11] as Map<string, bigint>).get(
        await sha256(fromText(fullDenom)),
      ),
      1000n,
    );
    assertEquals(
      (await wallet.wallet().getUtxos()).reduce(
        (sum, u) => sum + (u.assets[unit] ?? 0n),
        0n,
      ),
      1000n,
    );
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
  // A cancelled upgrade left the closed counterparty at upgrade sequence 2.
  const closed = "08041001" +
    bytes(3, bytes(1, fromText("transfer")) + bytes(2, fromText("channel-0"))) +
    bytes(4, remoteConnection) + bytes(5, fromText("ics20-1")) + "3002";
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
    2n,
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

Deno.test("full accounting maps reserve pending sends then swap assets after settlement within ledger budgets", async () => {
  const f = await packetLaneFixture(2);
  const wallet = await f.wallet();
  const address = await wallet.wallet().address();
  const leftDenoms: string[] = [];
  const packets: Constr<Data>[] = [];
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
    packets.push(...send.packets);
    await (await signMeasured(wallet, send.tx, `full-map send ${index}`))
      .submit();
    f.emulator.awaitBlock();
  }
  await assertRejects(
    () => buildPacketBalanceCompaction(wallet, f.deployment, 0, 1, leftDenoms),
    Error,
    "Settle outstanding sends",
  );
  for (const packet of packets) {
    const proof = await membershipProof(
      fromText(
        `acks/ports/transfer/channels/channel-7/sequences/${packet.fields[0]}`,
      ),
      await sha256(fromText('{"result":"AQ=="}')),
    );
    const height = record(1n, 20n + (packet.fields[0] as bigint));
    checkpoint(f, height, proof.root);
    const ack = await buildPacketAcknowledgement(
      wallet,
      f.deployment,
      packet,
      height,
      proof.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await (await signMeasured(wallet, ack.tx, "full-map acknowledgement"))
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
    assertEquals((datum.fields[6] as Map<Data, Data>).size, 0);
  }
  await (await signMeasured(wallet, compact.tx, "full-map redistribution"))
    .submit();
  f.emulator.awaitBlock();
});
