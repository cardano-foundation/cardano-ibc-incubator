import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CML,
  Constr,
  credentialToAddress,
  Data,
  fromText,
  getAddressDetails,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import { packetLaneFixture, signMeasured } from "./packet-lane-fixture.ts";
import { membershipProof } from "./channel-fixture.ts";
import { absenceProof } from "./packet-budget-fixture.ts";
import {
  assertLedgerSupply,
  ledgerBalances,
  packetCommitment,
} from "./funds-oracle.ts";
import {
  buildPacketAcknowledgement,
  buildPacketReceive,
  buildPacketRejection,
  buildPacketSendBatch,
  buildPacketTimeout,
  buildTransferIntent,
  encode,
  record,
  sha256,
  voucherTokenName,
} from "../packet-lane-transactions.ts";
import type { FundsCase } from "./funds-case.worker.ts";

type Fixture = Awaited<ReturnType<typeof packetLaneFixture>>;
type Mutation =
  | "short"
  | "excess"
  | "wrong_callback"
  | "wrong_commitment"
  | "wrong_balance"
  | "wrong_supply"
  | "wrong_recipient"
  | "wrong_proof";

function checkpoint(f: Fixture, height: Constr<Data>, root: string) {
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

// Change an otherwise valid transaction at its actual outputs or redeemer.
// The same generated case is evaluated successfully before every mutation.
async function mutated<T>(
  lucid: LucidEvolution,
  f: Fixture,
  mutation: Mutation,
  build: () => Promise<T>,
): Promise<T> {
  const original = lucid.newTx.bind(lucid);
  lucid.newTx = () => {
    const tx = original();
    const contract = tx.pay.ToContract.bind(tx.pay);
    tx.pay.ToContract =
      ((address: string, datum: any, assets: any, ...rest: any[]) => {
        assets = { ...assets };
        if (
          address === f.deployment.batchAddress &&
          (mutation === "short" || mutation === "excess")
        ) {
          const state = Data.from(datum.value) as Constr<Data>;
          const unit = state.fields[3] === ""
            ? "lovelace"
            : String(state.fields[3]) + state.fields[4];
          assets[unit] += mutation === "short" ? -1n : 1n;
          state.fields[6] = (state.fields[6] as bigint) +
            (mutation === "short" ? -1n : 1n);
          datum = { ...datum, value: encode(state) };
        }
        if (
          address === f.deployment.guardAddress &&
          (mutation === "wrong_commitment" || mutation === "wrong_balance")
        ) {
          const state = Data.from(datum.value) as Constr<Data>;
          if (state.fields.length === 12) {
            if (mutation === "wrong_commitment") {
              state.fields[5] = "ff".repeat(32);
            } else {state.fields[11] = new Map([[
                fromText("forged-obligation"),
                1n,
              ]]);}
            datum = { ...datum, value: encode(state) };
          }
        }
        return contract(address, datum, assets, ...rest);
      }) as typeof tx.pay.ToContract;
    const payment = tx.pay.ToAddressWithData.bind(tx.pay);
    tx.pay.ToAddressWithData =
      ((address: string, datum: any, assets: any, ...rest: any[]) => {
        if (mutation === "wrong_recipient") {
          address = credentialToAddress("Custom", {
            type: "Key",
            hash: "de".repeat(28),
          });
        }
        if (mutation === "short" || mutation === "excess") {
          assets = { ...assets };
          const unit = Object.keys(assets).find((u) => u !== "lovelace") ??
            "lovelace";
          assets[unit] += mutation === "short" ? -1n : 1n;
        }
        if (mutation === "wrong_supply") {
          assets = { ...assets };
          for (const unit of Object.keys(assets)) {
            if (unit.startsWith(f.deployment.voucherPolicy!)) {
              assets[unit] += 1n;
            }
          }
        }
        return payment(address, datum, assets, ...rest);
      }) as typeof tx.pay.ToAddressWithData;
    const mint = tx.mintAssets.bind(tx);
    tx.mintAssets = ((assets: any, redeemer: string) => {
      if (
        Object.keys(assets).some((unit) =>
          unit.startsWith(f.deployment.batchPolicy)
        ) && mutation === "wrong_callback"
      ) {
        const authorized = Data.from(redeemer) as Constr<Data>;
        const operation = authorized.fields[1] as Constr<Data>;
        if (operation.index === 0) {
          const packet = (operation.fields[2] as Constr<Data>[])[0];
          packet.fields[5] = fromText("{}");
        } else if ([1, 2, 5, 6].includes(operation.index)) {
          (operation.fields[0] as Constr<Data>).fields[5] = fromText("{}");
        }
        redeemer = encode(authorized);
      }
      if (mutation === "wrong_supply") {
        assets = { ...assets };
        for (const unit of Object.keys(assets)) {
          if (unit.startsWith(f.deployment.voucherPolicy!)) assets[unit] += 1n;
        }
      }
      return mint(assets, redeemer);
    }) as typeof tx.mintAssets;
    return tx;
  };
  try {
    return await build();
  } finally {
    lucid.newTx = original;
  }
}

export async function checkPacketFundsCase(sample: FundsCase) {
  const f = await packetLaneFixture(4);
  const user = await f.wallet(true);
  const batcher = await f.wallet(true);
  const ownerAddress = await user.wallet().address();
  const owner = getAddressDetails(ownerAddress).paymentCredential!.hash;
  const voucher = sample.voucherBase !== undefined;
  const denom = voucher
    ? `transfer/channel-0/${sample.voucherBase}`
    : sample.parameters.asset || fromText("lovelace");
  const unit = voucher
    ? f.deployment.voucherPolicy! + voucherTokenName(denom)
    : sample.parameters.asset || "lovelace";
  let nextSequence = 1n;
  let remoteSequence = 1n;
  let proofHeight = 20n;
  let escrow = 0n;
  let voucherSupply = 0n;
  const pending: {
    packet: Constr<Data>;
    amount: bigint;
    liquidityUnit?: string;
  }[] = [];
  const received: bigint[] = [];
  const distributed = new Map<string, bigint>();
  const amountTotal =
    [sample.parameters.amount, ...sample.amounts].reduce((a, b) => a + b, 0n) *
    50n;
  if (!voucher && unit !== "lovelace") {
    f.seed(
      ownerAddress,
      { lovelace: 5_000_000n, [unit]: amountTotal - 1n },
      Data.void(),
    );
    // Let excess-output mutations reach the validator instead of failing coin selection.
    f.seed(await batcher.wallet().address(), {
      lovelace: 5_000_000n,
      [unit]: 1n,
    }, Data.void());
  }
  if (voucher) {
    const token = voucherTokenName(denom);
    const metadata = record(
      new Map([
        [fromText("name"), fromText(sample.voucherBase!)],
        [fromText("ticker"), fromText(sample.voucherBase!)],
        [fromText("description"), fromText(`IBC voucher for ${denom}`)],
      ]),
      1n,
      new Map<Data, Data>([
        [fromText("path"), fromText("transfer/channel-0")],
        [fromText("baseDenom"), fromText(sample.voucherBase!)],
        [fromText("fullDenom"), fromText(denom)],
        [fromText("ibcDenomHash"), fromText(await sha256(fromText(denom)))],
        [fromText("traceVersion"), 1n],
        [fromText("voucherPolicyId"), fromText(f.deployment.voucherPolicy!)],
        [fromText("voucherTokenName"), fromText(token)],
      ]),
    );
    f.deployment.scripts.push(
      f.seed(
        credentialToAddress("Custom", { type: "Script", hash: f.metadataHash }),
        {
          lovelace: 5_000_000n,
          [f.deployment.voucherPolicy! + "000643b0" + token.slice(8)]: 1n,
        },
        encode(metadata),
      ),
    );
  }
  const submit = async (
    tx: ReturnType<LucidEvolution["newTx"]>,
    wallet = batcher,
    prepared?: Awaited<ReturnType<typeof signMeasured>>,
  ) => {
    const signed = prepared ??
      await (await tx.complete({ localUPLCEval: true })).sign.withWallet()
        .complete();
    const redeemers = signed.toTransaction().witness_set().redeemers();
    if (redeemers) {
      const units = CML.compute_total_ex_units(redeemers);
      assert(
        units.mem() <= wallet.config().protocolParameters!.maxTxExMem,
        `memory ${units.mem()} exceeds limit`,
      );
      assert(units.steps() <= wallet.config().protocolParameters!.maxTxExSteps);
    }
    assert(
      signed.toCBOR().length / 2 <=
        wallet.config().protocolParameters!.maxTxSize,
    );
    await signed.submit();
    f.emulator.awaitBlock();
  };
  const liquidity = async (amount: bigint) => {
    const outputs = (await batcher.utxosAt(f.deployment.batchAddress)).sort((
      a,
      b,
    ) =>
      Number((Data.from(b.datum!) as Constr<Data>).fields[6]) -
      Number((Data.from(a.datum!) as Constr<Data>).fields[6])
    );
    const selected: UTxO[] = [];
    let total = 0n;
    for (const output of outputs) {
      if (total >= amount) break;
      selected.push(output);
      total += (Data.from(output.datum!) as Constr<Data>).fields[6] as bigint;
    }
    return selected;
  };
  const audit = async () => {
    const outputs = await batcher.utxosAt(f.deployment.batchAddress);
    assertEquals(
      outputs.reduce(
        (sum, u) =>
          sum + ((Data.from(u.datum!) as Constr<Data>).fields[6] as bigint),
        0n,
      ),
      escrow,
    );
    const lanes = (await batcher.utxosAt(f.deployment.guardAddress)).filter((
      u,
    ) => u.datum && (Data.from(u.datum) as Constr<Data>).fields.length === 12);
    const commitments = new Map<Data, Data>();
    const receipts: bigint[] = [];
    for (const output of lanes) {
      const state = Data.from(output.datum!) as Constr<Data>;
      for (const entry of state.fields[6] as Map<Data, Data>) {
        commitments.set(...entry);
      }
      receipts.push(...state.fields[7] as bigint[]);
    }
    assertEquals(
      commitments,
      new Map(
        pending.map((p) => [p.packet.fields[0], packetCommitment(p.packet)]),
      ),
    );
    assertEquals(receipts.sort(), [...received].sort());
    const sequencer = (await batcher.utxosAt(f.deployment.guardAddress)).find((
      u,
    ) => u.datum && (Data.from(u.datum) as Constr<Data>).fields.length === 4)!;
    assertEquals(
      (Data.from(sequencer.datum!) as Constr<Data>).fields[3],
      nextSequence,
    );
    if (unit !== "lovelace") {
      assertLedgerSupply(
        f.emulator,
        unit,
        voucher ? voucherSupply : amountTotal,
      );
    }
    for (const [address, expected] of distributed) {
      assertEquals(ledgerBalances(f.emulator, unit).get(address), expected);
    }
  };
  const rejected = async (
    mutation: Mutation,
    build: () => Promise<{ tx: ReturnType<LucidEvolution["newTx"]> }>,
  ) => {
    console.log("funds mutation", mutation);
    const candidate = await mutated(batcher, f, mutation, build);
    await assertRejects(
      () => candidate.tx.complete({ localUPLCEval: true }),
      Error,
      "failed script execution",
    );
  };
  const send = async (amount: bigint) => {
    console.log("funds send", amount);
    const intentTx = await buildTransferIntent(user, f.deployment, {
      amount,
      assetUnit: unit,
      fullDenom: voucher ? denom : undefined,
      reserve: sample.parameters.reserve,
      receiver: sample.parameters.receiver,
      memo: sample.parameters.memo,
      timeoutTimestamp: BigInt(f.emulator.now() + 3_600_000) * 1_000_000n,
    });
    await submit(intentTx, user);
    const intents = (await user.utxosAt(f.deployment.guardAddress)).filter((
      u,
    ) => (Data.from(u.datum!) as Constr<Data>).fields.length === 5);
    assertEquals(intents.length, 1);
    const build = () =>
      buildPacketSendBatch(
        batcher,
        f.deployment,
        intents,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
    const valid = await build();
    const prepared = await (await valid.tx.complete({ localUPLCEval: true }))
      .sign.withWallet().complete();
    for (
      const mutation of (voucher
        ? [
          "wrong_callback",
          "wrong_commitment",
          "wrong_balance",
          "wrong_supply",
        ]
        : [
          "short",
          "excess",
          "wrong_callback",
          "wrong_commitment",
          "wrong_balance",
        ]) as Mutation[]
    ) await rejected(mutation, build);
    await submit(valid.tx, batcher, prepared);
    pending.push({
      packet: valid.packets[0],
      amount,
      liquidityUnit: valid.escrows[0]
        ? Object.keys(valid.escrows[0].assets).find((asset) =>
          asset.startsWith(f.deployment.batchPolicy)
        )
        : undefined,
    });
    nextSequence++;
    if (voucher) voucherSupply -= amount;
    else escrow += amount;
    await audit();
  };
  const receive = async (amount: bigint, mintedVoucher = false) => {
    const data = {
      denom: mintedVoucher
        ? sample.voucherBase!
        : `transfer/channel-7/${denom}`,
      amount: amount.toString(),
      sender: "cosmos1sender",
      receiver: owner,
      memo: sample.parameters.memo,
    };
    const packet = record(
      remoteSequence,
      fromText("transfer"),
      fromText("channel-7"),
      fromText("transfer"),
      fromText("channel-0"),
      fromText(JSON.stringify(data)),
      record(0n, 0n),
      BigInt(f.emulator.now() + 3_600_000) * 1_000_000n,
    );
    const proof = await membershipProof(
      fromText(
        `commitments/ports/transfer/channels/channel-7/sequences/${remoteSequence}`,
      ),
      packetCommitment(packet),
    );
    const height = record(1n, proofHeight++);
    checkpoint(f, height, proof.root);
    const funds = mintedVoucher ? [] : await liquidity(amount);
    const build = () =>
      buildPacketReceive(
        batcher,
        f.deployment,
        packet,
        height,
        proof.proof,
        funds,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
    const valid = await build();
    const prepared = await (await valid.tx.complete({ localUPLCEval: true }))
      .sign.withWallet().complete();
    for (
      const mutation of ["wrong_callback", "wrong_recipient"] as Mutation[]
    ) await rejected(mutation, build);
    await rejected("wrong_balance", build);
    if (mintedVoucher) await rejected("wrong_supply", build);
    checkpoint(f, height, "ff".repeat(32));
    await assertRejects(
      async () => (await build()).tx.complete({ localUPLCEval: true }),
      Error,
      "failed script execution",
    );
    checkpoint(f, height, proof.root);
    await submit(valid.tx, batcher, prepared);
    received.push(remoteSequence++);
    if (mintedVoucher) voucherSupply += amount;
    else escrow -= amount;
    await assertRejects(build, Error, "already received");
    await audit();
  };
  const settle = async (index: number, kind: "ack" | "error" | "timeout") => {
    const chosen = index % pending.length;
    const sent = pending[chosen];
    if (kind === "timeout") {
      f.emulator.awaitSlot(
        Math.max(
          1,
          Math.ceil(
            (Number(sent.packet.fields[7] as bigint / 1_000_000n) -
              f.emulator.now()) / 1000,
          ) + 1,
        ),
      );
    }
    const sequence = sent.packet.fields[0];
    const path = fromText(
      `${
        kind === "timeout" ? "receipts" : "acks"
      }/ports/transfer/channels/channel-7/sequences/${sequence}`,
    );
    const proof = kind === "timeout"
      ? await absenceProof(path)
      : await membershipProof(
        path,
        await sha256(
          fromText(
            kind === "ack" ? '{"result":"AQ=="}' : '{"error":"rejected"}',
          ),
        ),
      );
    const height = record(1n, proofHeight++);
    checkpoint(f, height, proof.root);
    const funds = voucher || kind === "ack"
      ? []
      : [await batcher.utxoByUnit(sent.liquidityUnit!)];
    const build = () =>
      kind === "ack"
        ? buildPacketAcknowledgement(
          batcher,
          f.deployment,
          sent.packet,
          height,
          proof.proof,
          f.emulator.now(),
          f.emulator.now() + 60_000,
        )
        : kind === "error"
        ? buildPacketRejection(
          batcher,
          f.deployment,
          sent.packet,
          height,
          proof.proof,
          funds,
          "rejected",
          f.emulator.now(),
          f.emulator.now() + 60_000,
        )
        : buildPacketTimeout(
          batcher,
          f.deployment,
          sent.packet,
          height,
          proof.proof,
          funds,
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
    const valid = await build();
    const prepared = await (await valid.tx.complete({ localUPLCEval: true }))
      .sign.withWallet().complete();
    await rejected("wrong_callback", build);
    if (kind !== "ack") {
      await rejected("wrong_recipient", build);
      await rejected("wrong_balance", build);
      if (voucher) await rejected("wrong_supply", build);
    }
    checkpoint(f, height, "ff".repeat(32));
    await assertRejects(
      async () => (await build()).tx.complete({ localUPLCEval: true }),
      Error,
      "failed script execution",
    );
    checkpoint(f, height, proof.root);
    await submit(valid.tx, batcher, prepared);
    pending.splice(chosen, 1);
    if (kind !== "ack") {
      if (voucher) voucherSupply += sent.amount;
      else escrow -= sent.amount;
    }
    await assertRejects(build, Error, "commitment is absent");
    await audit();
  };
  if (voucher) {
    await receive(amountTotal, true);
    for (const destination of sample.destinations ?? []) {
      const address = credentialToAddress("Custom", {
        type: destination.script ? "Script" : "Key",
        hash: destination.hash,
      });
      const amount = sample.amounts[0];
      await submit(
        user.newTx().pay.ToAddress(address, { [unit]: amount }),
        user,
      );
      distributed.set(address, (distributed.get(address) ?? 0n) + amount);
    }
  }
  await send(sample.parameters.amount);
  let cursor = 0;
  await send(sample.amounts[cursor++ % sample.amounts.length]);
  for (const command of sample.commands) {
    if (command.send || !pending.length) {
      await send(sample.amounts[cursor++ % sample.amounts.length]);
    } else await settle(command.index, command.settlement);
  }
  for (const kind of ["ack", "error", "timeout"] as const) {
    if (!pending.length) {
      await send(sample.amounts[cursor++ % sample.amounts.length]);
    }
    await settle(sample.commands.length, kind);
  }
  while (pending.length) await settle(pending.length - 1, "error");
  if (!voucher) {
    if (escrow > 1n) {
      const [largest] = await liquidity(1n);
      const available = (Data.from(largest.datum!) as Constr<Data>)
        .fields[6] as bigint;
      if (available > 1n) await receive(available / 2n);
    }
    while (escrow) {
      const [largest] = await liquidity(1n);
      await receive(
        (Data.from(largest.datum!) as Constr<Data>).fields[6] as bigint,
      );
    }
  }
  await audit();
  assert(nextSequence > 2n, "overlapping packets exercised");
}
