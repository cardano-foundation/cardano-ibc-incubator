/** Reconciled Cardano transaction costs. This is a compiled-validator lab
 * benchmark, not a live two-chain throughput or endurance qualification.
 */
import { assert, assertEquals } from "@std/assert";
import {
  applyDoubleCborEncoding,
  CML,
  type Constr,
  credentialToAddress,
  Data,
  fromText,
  getAddressDetails,
  type LucidEvolution,
  type ProtocolParameters,
  toText,
  type TxSigned,
  type UTxO,
  utxoToCore,
} from "@lucid-evolution/lucid";
import {
  type CostMeasurement,
  type CostProfile,
  type CostRole,
  measureTransaction,
  projectFunding,
  stringifyCosts,
} from "../src/relayer-accounting.ts";
import { membershipProof } from "../src/testing/channel-fixture.ts";
import { absenceProof } from "../src/testing/packet-budget-fixture.ts";
import {
  packetLaneFixture,
  signMeasured,
} from "../src/testing/packet-lane-fixture.ts";
import {
  buildPacketAcknowledgement,
  buildPacketAcknowledgementBatch,
  buildPacketPrune,
  buildPacketReceive,
  buildPacketRejection,
  buildPacketSendBatch,
  buildPacketTimeout,
  buildTransferIntent,
  encode,
  record,
  sha256,
  variant,
  voucherTokenName,
} from "../src/packet-lane-transactions.ts";
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

type Fixture = Awaited<ReturnType<typeof packetLaneFixture>>;
type Observed = CostMeasurement & {
  phase: string;
  feePayer: string;
  referenceScripts: Array<{ hash: string; bytes: number }>;
  referenceScriptBytes: number;
  walletBefore: Record<string, bigint>;
  walletBalanceChecks?: Record<string, bigint>;
};
const output = Deno.args[0] ?? "/tmp/relayer-costs.json";
const workload: {
  executionsPerDay: Record<string, number>;
  days: number;
  concurrency: number;
  spendableReserveLovelace: string;
  upfrontLovelace?: string;
  reimbursementPerDayLovelace?: string;
  reimbursementDelayDays?: number;
} = Deno.args[1] ? JSON.parse(await Deno.readTextFile(Deno.args[1])) : {
  executionsPerDay: {
    "outbound-ada-ack": 100,
    "receive-existing-voucher": 99,
    "receive-new-voucher": 1,
  },
  days: 30,
  concurrency: 4,
  spendableReserveLovelace: "10000000",
  upfrontLovelace: "0",
  reimbursementPerDayLovelace: "0",
  reimbursementDelayDays: 0,
};
const scenarioNames = [
  "outbound-ada-ack",
  "outbound-ada-ack-pairs",
  "outbound-native-ack",
  "outbound-ada-timeout",
  "outbound-ada-error",
  "outbound-ada-return",
  "receive-existing-voucher",
  "receive-new-voucher",
];
const selected = Deno.args[2]?.split(",") ?? scenarioNames;
if (selected.some((name) => !scenarioNames.includes(name))) {
  throw new Error("Unknown benchmark scenario");
}
if (
  new Set(selected).size !== selected.length ||
  Object.keys(workload.executionsPerDay).some((name) =>
    !selected.includes(name)
  )
) {
  throw new Error("Workload must reference unique measured scenarios");
}
try {
  await Deno.stat(output);
  throw new Error(
    "Output already exists. Choose a new path to retain the earlier evidence",
  );
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
const journal = output + ".transactions.jsonl";
await Deno.writeTextFile(journal, "", { createNew: true });
const evidence = (event: unknown) =>
  Deno.writeTextFile(journal, stringifyCosts(event, 0), { append: true });
const scenarios: Array<
  {
    name: string;
    operations: number;
    profileSamples: number;
    profileBasis: string;
    pairing?: { requested: number; accepted: number; fallback: number };
    transactions: Observed[];
    coldStartProfile: CostProfile;
    profile: CostProfile;
  }
> = [];
const setup: Observed[] = [];
let effectiveProtocolParameters: ProtocolParameters | undefined;
const setupWallets = new Map<string, string>();
const paymentHash = (address: string) => {
  const credential = getAddressDetails(address).paymentCredential;
  if (credential?.type !== "Key") throw new Error("Expected a payment key");
  return credential.hash;
};
const walletRole = (name: string): CostRole => ({
  name,
  wallet: true,
  controller: name,
  recoveryRecipient: name,
  recoveryCondition: "Payment-key holder can spend the output",
});
const stateRole: CostRole = {
  name: "protocol-state",
  controller: "Protocol validators",
  recoveryRecipient: "Determined by the applicable protocol transition",
  recoveryCondition:
    "No reimbursement entitlement for the original relayer is assumed",
};
async function balances(lucid: LucidEvolution, wallets: Map<string, string>) {
  const result: Record<string, bigint> = {};
  for (const [hash, name] of wallets) {
    const utxos = await lucid.config().provider!.getUtxos({
      type: "Key",
      hash,
    });
    result[name] = utxos.reduce((total, u) => total + u.assets.lovelace, 0n);
  }
  return result;
}
async function capture(
  lucid: LucidEvolution,
  signed: TxSigned,
  phase: string,
  feePayer: string,
  wallets: Map<string, string>,
  classify: (u: UTxO) => CostRole,
): Promise<Observed> {
  const body = signed.toTransaction().body();
  const refs = (inputs: ReturnType<typeof body.inputs> | undefined) => {
    const result = [];
    for (let i = 0; inputs && i < inputs.len(); i++) {
      result.push({
        txHash: inputs.get(i).transaction_id().to_hex(),
        outputIndex: Number(inputs.get(i).index()),
      });
    }
    return result;
  };
  const provider = lucid.config().provider!;
  const [inputs, collateral, references] = await Promise.all([
    provider.getUtxosByOutRef(refs(body.inputs())),
    provider.getUtxosByOutRef(refs(body.collateral_inputs())),
    provider.getUtxosByOutRef(refs(body.reference_inputs())),
  ]);
  const referenceScripts = [...inputs, ...references].filter((u) => u.scriptRef)
    .map((u) => {
      const script = utxoToCore(u).output().script_ref()!;
      const plutus = script.as_plutus_v3();
      assert(plutus);
      return {
        hash: script.hash().to_hex(),
        bytes: plutus.to_raw_bytes().length,
      };
    });
  const observed = {
    phase,
    feePayer,
    referenceScripts,
    referenceScriptBytes: referenceScripts.reduce(
      (sum, script) => sum + script.bytes,
      0,
    ),
    walletBefore: await balances(lucid, wallets),
    ...measureTransaction(
      signed.toCBOR(),
      inputs,
      collateral,
      lucid.config().protocolParameters!.coinsPerUtxoByte,
      classify,
    ),
  };
  await evidence({
    kind: "prepared",
    at: new Date().toISOString(),
    measurement: observed,
  });
  return observed;
}
async function verifyWallets(
  lucid: LucidEvolution,
  observed: Observed,
  wallets: Map<string, string>,
) {
  const after = await balances(lucid, wallets);
  observed.walletBalanceChecks = {};
  for (const name of wallets.values()) {
    const actualDebit = observed.walletBefore[name] - after[name];
    assertEquals(
      actualDebit,
      observed.roles[name]?.netDebitLovelace ?? 0n,
      `${observed.phase}: ${name} wallet reconciliation`,
    );
    observed.walletBalanceChecks[name] = actualDebit;
  }
  await evidence({
    kind: "reconciled",
    at: new Date().toISOString(),
    transaction: observed.transaction,
    walletBalanceChecks: observed.walletBalanceChecks,
  });
}
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
async function remotePacket(
  f: Fixture,
  sequence: bigint,
  denom: string,
  amount: string,
  receiver: string,
) {
  const timeout = BigInt(f.emulator.now() + 3_600_000) * 1_000_000n;
  const payload = fromText(
    JSON.stringify({
      denom,
      amount,
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
  const height = record(1n, 19n + sequence);
  checkpoint(f, height, proof.root);
  return { packet, proof: proof.proof, height };
}
for (const name of selected) {
  const transactions: Observed[] = [];
  const paired = name === "outbound-ada-ack-pairs";
  const pairing = { requested: 0, accepted: 0, fallback: 0 };
  const pending: {
    packet: Constr<Data>;
    proofHeight: Constr<Data>;
    proof: Constr<Data>;
  }[] = [];
  const iterations =
    ["outbound-ada-ack", "outbound-ada-ack-pairs", "receive-existing-voucher"]
        .includes(name)
      ? 32
      : 1;
  const starts: number[] = [];
  let initLucid: LucidEvolution | undefined;
  const f = await packetLaneFixture(
    16,
    Math.max(8, iterations),
    setup.length ? undefined : async (lucid, signed) => {
      const hash = paymentHash(await lucid.wallet().address());
      setupWallets.set(hash, "setup-sponsor");
      initLucid = lucid;
      setup.push(
        await capture(
          lucid,
          signed,
          "channel-lane-initialization",
          "setup-sponsor",
          setupWallets,
          (u) => {
            const key = getAddressDetails(u.address).paymentCredential;
            if (
              key?.type === "Key" && setupWallets.has(key.hash)
            ) return walletRole("setup-sponsor");
            if (key?.type !== "Script") {
              throw new Error("Unclassified setup output");
            }
            return stateRole;
          },
        ),
      );
    },
  );
  if (initLucid) await verifyWallets(initLucid, setup[0], setupWallets);
  const relayer = await f.wallet(true),
    user = await f.wallet(true),
    recipient = await f.wallet(true);
  effectiveProtocolParameters ??= structuredClone(
    relayer.config().protocolParameters!,
  );
  const wallets = new Map<string, string>();
  for (
    const [label, lucid] of [["relayer", relayer], ["user", user], [
      "recipient",
      recipient,
    ]] as const
  ) {
    wallets.set(paymentHash(await lucid.wallet().address()), label);
  }
  const classify = (u: UTxO): CostRole => {
    const credential = getAddressDetails(u.address).paymentCredential;
    if (credential?.type === "Key" && wallets.has(credential.hash)) {
      return walletRole(wallets.get(credential.hash)!);
    }
    if (credential?.type === "Script" && credential.hash === f.metadataHash) {
      return {
        name: "metadata",
        controller: "voucher_metadata validator",
        recoveryRecipient: "HostStateDatum.deployer",
        recoveryCondition:
          "Authorized shutdown after voucher dependencies are drained. Not an automatic relayer refund",
      };
    }
    if (u.address === f.deployment.batchAddress) {
      const data = Data.from(u.datum!) as Constr<Data>;
      const owner = (data.fields[7] as Constr<Data>).fields[0] as Constr<Data>;
      return {
        name: "liquidity",
        controller: "Packet liquidity validators",
        recoveryRecipient: String(owner.fields[0]),
        recoveryCondition:
          "Deposit reserve returned to its recorded owner when liquidity is retired or fully refunded",
        principalLovelace: data.fields[3] === "" && data.fields[4] === ""
          ? data.fields[6] as bigint
          : 0n,
      };
    }
    if (u.address === f.deployment.guardAddress) {
      const datum = Data.from(u.datum!) as Constr<Data>;
      if (datum.fields.length === 5) {
        const payload = (datum.fields[3] as Constr<Data>).fields;
        return {
          name: "funded-intent",
          controller: "Funded-intent validator",
          recoveryRecipient: String(datum.fields[2]),
          recoveryCondition:
            "Owner cancellation or forwarding into the owner's liquidity deposit",
          principalLovelace: toText(String(payload[0])) === fromText("lovelace")
            ? BigInt(toText(String(payload[1])))
            : 0n,
        };
      }
      return stateRole;
    }
    if (u.address === f.traceAddress) {
      return { ...stateRole, name: "trace-registry" };
    }
    throw new Error(`Unclassified transaction address ${u.address}`);
  };
  const submit = async (
    lucid: LucidEvolution,
    signed: TxSigned,
    phase: string,
    payer: string,
  ) => {
    const observed = await capture(
      lucid,
      signed,
      phase,
      payer,
      wallets,
      classify,
    );
    transactions.push(observed);
    await signed.submit();
    f.emulator.awaitBlock();
    await verifyWallets(lucid, observed, wallets);
  };
  for (let iteration = 0; iteration < iterations; iteration++) {
    starts.push(transactions.length);
    if (name.startsWith("outbound")) {
      const native = name === "outbound-native-ack";
      const asset = "ab".repeat(28) + fromText("BENCH");
      if (native) {
        f.seed(await user.wallet().address(), {
          lovelace: 5_000_000n,
          [asset]: 1000n,
        }, Data.void());
      }
      const intent = await buildTransferIntent(user, f.deployment, {
        amount: native ? 1000n : 2_000_000n,
        ...(native ? { assetUnit: asset } : {}),
        receiver: "cosmos1receiver",
        timeoutTimestamp: BigInt(f.emulator.now() + 3_600_000) * 1_000_000n,
      });
      const admitted = await (await intent.complete()).sign.withWallet()
        .complete();
      await submit(user, admitted, "intent-admission", "user");
      const intents = (await relayer.utxosAt(f.deployment.guardAddress)).filter(
        (
          u,
        ) => u.txHash === admitted.toHash(),
      );
      const batch = await buildPacketSendBatch(
        relayer,
        f.deployment,
        intents,
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
      await submit(
        relayer,
        await signMeasured(relayer, batch.tx, name + " send"),
        "send",
        "relayer",
      );
      if (paired) {
        const proof = f.proofs.get(BigInt(iteration + 1))!;
        pending.push({
          packet: batch.packets[0],
          proofHeight: proof.height,
          proof: proof.proof,
        });
        if (pending.length < 2) continue;
        pairing.requested++;
        const built = await buildPacketAcknowledgementBatch(
          relayer,
          f.deployment,
          pending,
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
        const signed = await signMeasured(
          relayer,
          built.tx,
          name + " settlement",
        );
        const units = CML.compute_total_ex_units(
          signed.toTransaction().witness_set().redeemers()!,
        );
        const limits = relayer.config().protocolParameters!;
        const eligible = units.mem() * 5n <= limits.maxTxExMem * 4n &&
          units.steps() * 5n <= limits.maxTxExSteps * 4n &&
          signed.toCBOR().length / 2 * 5 <= limits.maxTxSize * 4;
        await evidence({
          kind: "batch-candidate",
          eligible,
          memory: units.mem(),
          cpu: units.steps(),
          bytes: signed.toCBOR().length / 2,
        });
        if (eligible) {
          pairing.accepted++;
          await submit(relayer, signed, "paired-settlement", "relayer");
        } else {
          pairing.fallback++;
          for (const request of pending) {
            const single = await buildPacketAcknowledgement(
              relayer,
              f.deployment,
              request.packet,
              request.proofHeight,
              request.proof,
              f.emulator.now(),
              f.emulator.now() + 60_000,
            );
            await submit(
              relayer,
              await signMeasured(relayer, single.tx, "pair budget fallback"),
              "settlement",
              "relayer",
            );
          }
        }
        pending.length = 0;
        continue;
      }
      let settled;
      if (name === "outbound-ada-timeout") {
        f.emulator.awaitBlock(181);
        const height = record(1n, 19n);
        const proof = await absenceProof(
          fromText("receipts/ports/transfer/channels/channel-7/sequences/1"),
        );
        checkpoint(f, height, proof.root);
        settled = await buildPacketTimeout(
          relayer,
          f.deployment,
          batch.packets[0],
          height,
          proof.proof,
          await relayer.utxosAt(f.deployment.batchAddress),
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
      } else if (name === "outbound-ada-error") {
        const error = "receiver rejected transfer";
        const height = record(1n, 19n);
        const proof = await membershipProof(
          fromText("acks/ports/transfer/channels/channel-7/sequences/1"),
          await sha256(fromText(JSON.stringify({ error }))),
        );
        checkpoint(f, height, proof.root);
        settled = await buildPacketRejection(
          relayer,
          f.deployment,
          batch.packets[0],
          height,
          proof.proof,
          await relayer.utxosAt(f.deployment.batchAddress),
          error,
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
      } else {
        const proof = f.proofs.get(BigInt(iteration + 1))!;
        settled = await buildPacketAcknowledgement(
          relayer,
          f.deployment,
          batch.packets[0],
          proof.height,
          proof.proof,
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
      }
      await submit(
        relayer,
        await signMeasured(relayer, settled.tx, name + " settlement"),
        "settlement",
        "relayer",
      );
      if (name === "outbound-ada-return") {
        const remote = await remotePacket(
          f,
          1n,
          `transfer/channel-7/${fromText("lovelace")}`,
          "2000000",
          paymentHash(await user.wallet().address()),
        );
        const receive = await buildPacketReceive(
          relayer,
          f.deployment,
          remote.packet,
          remote.height,
          remote.proof,
          await relayer.utxosAt(f.deployment.batchAddress),
          f.emulator.now(),
          f.emulator.now() + 60_000,
        );
        await submit(
          relayer,
          await signMeasured(
            relayer,
            receive.tx,
            "ADA return and reserve refund",
          ),
          "return",
          "relayer",
        );
      }
    } else {
      const fullDenom = "transfer/channel-0/uatom",
        token = voucherTokenName(fullDenom);
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
          [
            fromText("ibcDenomHash"),
            fromText(await sha256(fromText(fullDenom))),
          ],
          [fromText("traceVersion"), 1n],
          [fromText("voucherPolicyId"), fromText(f.deployment.voucherPolicy!)],
          [fromText("voucherTokenName"), fromText(token)],
        ]),
      );
      const metadataAddress = credentialToAddress("Custom", {
        type: "Script",
        hash: f.metadataHash,
      });
      const metadataUnit = f.deployment.voucherPolicy! + "000643b0" +
        token.slice(8);
      if (name === "receive-existing-voucher" && iteration === 0) {
        f.deployment.scripts.push(
          f.seed(
            metadataAddress,
            { lovelace: 5_000_000n, [metadataUnit]: 1n },
            encode(metadata),
          ),
        );
      }
      const remote = await remotePacket(
        f,
        BigInt(iteration + 1),
        "uatom",
        "1000",
        paymentHash(await recipient.wallet().address()),
      );
      const receive = await buildPacketReceive(
        relayer,
        f.deployment,
        remote.packet,
        remote.height,
        remote.proof,
        [],
        f.emulator.now(),
        f.emulator.now() + 60_000,
      );
      if (name === "receive-new-voucher") {
        const policy = "94".repeat(28),
          bucket = parseInt(token.slice(8, 9), 16);
        const shardName = (index: number) => fromText(`shard-${index}`);
        const directory = f.seed(
          f.traceAddress,
          { lovelace: 10_000_000n, [policy + "02"]: 1n },
          encode(variant(
            1,
            record(
              Array.from(
                { length: 16 },
                (_, index) => record(BigInt(index), shardName(index), []),
              ),
            ),
          )),
        );
        const shard = f.seed(f.traceAddress, {
          lovelace: 10_000_000n,
          [policy + shardName(bucket)]: 1n,
        }, encode(variant(0, record(BigInt(bucket), []))));
        const reference = f.seed(
          f.traceAddress,
          { lovelace: 100_000_000n },
          Data.void(),
          {
            ...f.traceScript,
            script: applyDoubleCborEncoding(f.traceScript.script),
          },
        );
        receive.tx.readFrom([directory, reference])
          .collectFrom(
            [shard],
            encode(variant(0, token.slice(8), fromText(fullDenom))),
          )
          .pay.ToContract(f.traceAddress, {
            kind: "inline",
            value: encode(
              variant(
                0,
                record(BigInt(bucket), [
                  record(token.slice(8), fromText(fullDenom)),
                ]),
              ),
            ),
          }, shard.assets)
          .mintAssets({ [metadataUnit]: 1n }, encode(variant(4)))
          .pay.ToContract(metadataAddress, {
            kind: "inline",
            value: encode(metadata),
          }, { [metadataUnit]: 1n });
      }
      await submit(
        relayer,
        await signMeasured(relayer, receive.tx, name),
        "receive",
        "relayer",
      );
    }
  }
  const profileFor = (
    rows: Observed[],
    count: number,
    profileName = name,
  ): CostProfile => {
    const total = (field: (tx: Observed) => bigint) => {
      const value = rows.reduce((n, tx) => n + field(tx), 0n);
      // Conservative whole-lovelace average, including negative releases.
      return value >= 0n
        ? (value + BigInt(count) - 1n) / BigInt(count)
        : value / BigInt(count);
    };
    return {
      name: profileName,
      relayerNetDebitLovelace: total((tx) =>
        tx.roles.relayer?.netDebitLovelace ?? 0n
      ),
      relayerFeesLovelace: total((tx) =>
        tx.feePayer === "relayer" ? tx.feeLovelace : 0n
      ),
      recipientTopUpLovelace: total((tx) =>
        -(tx.roles.recipient?.netDebitLovelace ?? 0n)
      ),
      protocolReserveIncreaseLovelace: total((tx) =>
        Object.values(tx.roles).filter((role) => !role.wallet).reduce(
          (n, role) => n + role.netReserveIncreaseLovelace,
          0n,
        )
      ),
      collateralLovelace: rows.reduce(
        (n, tx) =>
          tx.collateral.reservedLovelace > n
            ? tx.collateral.reservedLovelace
            : n,
        0n,
      ),
    };
  };
  const profileSamples = iterations > 1 ? iterations - 16 : 1;
  const profile = profileFor(
    transactions.slice(iterations > 1 ? starts[16] : 0),
    profileSamples,
  );
  const coldStartProfile = profileFor(
    transactions.slice(0, starts[paired ? 2 : 1] ?? transactions.length),
    paired ? 2 : 1,
  );
  scenarios.push({
    name,
    operations: iterations,
    profileSamples,
    profileBasis: iterations > 1
      ? paired
        ? "Per-transfer mean of operations 17..32 with two already-ready acknowledgements at a common proof height on distinct lanes. Sends remain single. No pruning or collection timer"
        : "Mean of operations 17..32 after all 16 lanes have been used. No pruning"
      : "Single cold operation. Not a steady-state traffic estimate",
    ...(paired ? { pairing } : {}),
    transactions,
    coldStartProfile,
    profile,
  });
  console.log(stringifyCosts(profile).trim());
  if (name === "receive-existing-voucher") {
    // The 32 receives above are already recorded. Measure cleanup separately so
    // its cost can be added once per received packet without double counting.
    const absence = await absenceProof(fromText(
      "commitments/ports/transfer/channels/channel-7/sequences/1",
    ));
    const height = record(1n, 100n);
    checkpoint(f, height, absence.root);
    const prune = await buildPacketPrune(
      relayer,
      f.deployment,
      1n,
      height,
      absence.proof,
      f.emulator.now(),
      f.emulator.now() + 60_000,
    );
    await submit(
      relayer,
      await signMeasured(relayer, prune.tx, "prune received packet"),
      "prune",
      "relayer",
    );
    const transaction = transactions.pop()!;
    const profile = profileFor([transaction], 1, "packet-prune");
    scenarios.push({
      name: "packet-prune",
      operations: 1,
      profileSamples: 1,
      profileBasis:
        "One receipt/acknowledgement cleanup after 32 receives on 16 lanes. The counterparty absence proof is fixture pre-state. Prerequisite receives are accounted for in receive-existing-voucher",
      transactions: [transaction],
      coldStartProfile: profile,
      profile,
    });
    console.log(stringifyCosts(profile).trim());
  }
}
const repository = new URL("../../../", import.meta.url);
const commit = new TextDecoder().decode(
  (await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: repository,
  }).output()).stdout,
).trim();
const usedWorkload = Object.fromEntries(
  Object.entries(workload.executionsPerDay).filter(([name]) =>
    selected.includes(name)
  ),
);
if (
  Object.keys(usedWorkload).length !==
    Object.keys(workload.executionsPerDay).length
) throw new Error("Workload includes an unmeasured scenario");
const report = {
  generatedAt: new Date().toISOString(),
  repositoryCommit: commit,
  repositoryDirty: (await new Deno.Command("git", {
    args: ["status", "--porcelain"],
    cwd: repository,
  }).output()).stdout.length > 0,
  denoVersion: Deno.version.deno,
  mode:
    "Signed transactions submitted to a compiled-validator emulator. Counterparty checkpoints and initial deployment are authenticated fixture pre-state",
  evaluator: Deno.env.get("PACKET_LANE_NODE_URL")
    ? "Ogmios with additional fixture UTxOs"
    : "Scalus",
  parameters,
  effectiveProtocolParameters,
  blueprintSha256: await sha256(
    Array.from(
      await Deno.readFile(
        new URL("../../onchain/plutus.json", import.meta.url),
      ),
    ).map((x) => x.toString(16).padStart(2, "0")).join(""),
  ),
  limits: [
    "Not live-chain transaction references",
    "No throughput or endurance claim",
    "Client-update and counterparty gas costs not included",
    "Hosting and indexer operating costs not included",
    "Shared transaction builders are exercised directly. Gateway and Hermes signer funding-policy limits are not exercised",
    "Deployment, reference scripts, client updates and channel handshakes are fixture pre-state. Only channel-lane initialization is measured as setup",
    "Fixture registry reserves may absorb datum growth before further ADA is required",
    "No relayer refund entitlement or compensation is assumed",
  ],
  transactionJournal: journal,
  setup,
  scenarios,
  fundingProjection: projectFunding(
    scenarios.map((s) => s.profile),
    usedWorkload,
    {
      days: workload.days,
      concurrency: workload.concurrency,
      spendableReserveLovelace: BigInt(workload.spendableReserveLovelace),
      upfrontLovelace: BigInt(workload.upfrontLovelace ?? "0"),
      reimbursementPerDayLovelace: BigInt(
        workload.reimbursementPerDayLovelace ?? "0",
      ),
      reimbursementDelayDays: workload.reimbursementDelayDays ?? 0,
    },
  ),
};
await Deno.writeTextFile(output, stringifyCosts(report), { createNew: true });
console.log(`Cost report: ${output}`);
