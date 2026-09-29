import { assert } from "@std/assert";
import {
  applyDoubleCborEncoding,
  CML,
  Constr,
  credentialToAddress,
  Data,
  fromText,
  Lucid,
  type LucidEvolution,
  SLOT_CONFIG_NETWORK,
  type TxBuilder,
} from "@lucid-evolution/lucid";
import { createCostModels } from "@lucid-evolution/utils";
import { generateEmulatorAccount } from "@lucid-evolution/provider";
import parameters from "../../scripts/fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};
import {
  packetLaneTokenName,
  sendSequencerTokenName,
} from "../../../../packages/cardano-ibc-tx-builder/src/packet-lanes.ts";
import { readValidator } from "../utils.ts";
import {
  channelActions,
  channelFixture,
  defaultChannelParameters,
  membershipProof,
} from "./channel-fixture.ts";
import {
  completeTransaction,
  isolateEvaluation,
} from "./isolated-evaluation.ts";
import {
  buildTransferIntent,
  encode,
  type PacketLaneDeployment,
  record,
  sha256,
} from "../packet-lane-transactions.ts";

// Seed only the authenticated pre-state and test-wallet funds. Admission,
// batching and packet completion are balanced, signed transactions executing
// the compiled validators with the pinned mainnet protocol parameters.
export async function packetLaneFixture(laneCount = 16) {
  const fixture = await channelFixture(channelActions[4], {
    ...defaultChannelParameters,
    port: "transfer",
    remotePort: "transfer",
    version: "ics20-1",
    ordered: false,
  });
  const { emulator, seed, channelToken, packetContext: context } = fixture;
  Object.assign(emulator.protocolParameters, {
    maxTxSize: parameters.maxTxSize,
    maxTxExMem: BigInt(parameters.maxTxExMem),
    maxTxExSteps: BigInt(parameters.maxTxExSteps),
    coinsPerUtxoByte: BigInt(parameters.coinsPerUtxoByte),
    minFeeA: parameters.minFeeA,
    minFeeB: parameters.minFeeB,
    priceMem: parameters.priceMem,
    priceStep: parameters.priceStep,
    minFeeRefScriptCostPerByte: parameters.minFeeRefScriptCostPerByte,
  });
  emulator.protocolParameters.costModels.PlutusV3 = Object.fromEntries(
    parameters.plutusV3CostModel.map((cost, index) => [String(index), cost]),
  );
  const locked = credentialToAddress("Custom", {
    type: "Script",
    hash: "fe".repeat(28),
  });
  const statePolicy = "99".repeat(28);
  const sequencerToken = record(
    statePolicy,
    sendSequencerTokenName("transfer", "channel-0"),
  );
  const [batchScript, batchPolicy, batchAddress] = readValidator(
    "packet_lane_batch.packet_lane_batch.mint",
    fixture.lucid,
    [
      channelToken,
      sequencerToken,
      statePolicy,
      "11".repeat(28),
      "22".repeat(28),
      BigInt(laneCount),
    ],
  );
  const [guardScript, , guardAddress] = readValidator(
    "packet_lane_guard.packet_lane_guard.spend",
    fixture.lucid,
    [batchPolicy],
  );
  const scripts = [batchScript, guardScript].map((script) =>
    seed(locked, { lovelace: 100_000_000n }, Data.void(), {
      ...script,
      script: applyDoubleCborEncoding(script.script),
    })
  );
  const channelUnit = String(channelToken.fields[0]) +
    String(channelToken.fields[1]);
  const channel =
    Object.values(emulator.ledger).find(({ utxo }) =>
      utxo.assets[channelUnit] === 1n
    )!.utxo;
  channel.datum = encode(context.channelDatum(3));
  // Protect fixture references from wallet coin selection.
  channel.address = locked;
  context.client.address = locked;
  context.connection.address = locked;
  seed(guardAddress, {
    lovelace: 5_000_000n,
    [statePolicy + String(sequencerToken.fields[1])]: 1n,
  }, encode(record(fromText("transfer"), fromText("channel-0"), 0n, 1n)));
  for (let lane = 0; lane < laneCount; lane++) {
    seed(
      guardAddress,
      {
        lovelace: 5_000_000n,
        [
          statePolicy +
          packetLaneTokenName("transfer", "channel-0", lane, laneCount)
        ]: 1n,
      },
      encode(
        record(
          fromText("transfer"),
          fromText("channel-0"),
          BigInt(lane),
          BigInt(laneCount),
          0n,
          "00".repeat(32),
          new Map(),
          [],
          new Map(),
          record(0n, 0n),
          record(0n, 0n),
        ),
      ),
    );
  }
  const deployment: PacketLaneDeployment = {
    batchPolicy,
    batchAddress,
    guardAddress,
    statePolicy,
    laneCount,
    channel,
    connection: context.connection,
    client: context.client,
    scripts,
  };
  const proofs = new Map<
    bigint,
    { height: Constr<Data>; proof: Constr<Data> }
  >();
  const client = Data.from(context.client.datum!) as Constr<Data>;
  const state = client.fields[0] as Constr<Data>;
  const cs = state.fields[0] as Constr<Data>;
  // A single authenticated remote checkpoint covers all eight acknowledgement
  // leaves. Internal IAVL nodes use length-prefixed SHA-256 child hashes.
  const height = record(1n, 18n);
  const entries = [];
  for (let sequence = 1n; sequence <= 8n; sequence++) {
    const membership = await membershipProof(
      fromText(`acks/ports/transfer/channels/channel-7/sequences/${sequence}`),
      await sha256(fromText('{"result":"AQ=="}')),
    );
    const layers = membership.proof.fields[0] as Constr<Data>[];
    const existence = (layers[0].fields[0] as Constr<Data>).fields[0] as Constr<
      Data
    >;
    const outer = (layers[1].fields[0] as Constr<Data>).fields[0] as Constr<
      Data
    >;
    entries.push({
      sequence,
      proof: membership.proof,
      existence,
      outer,
      hash: outer.fields[1] as string,
    });
  }
  let nodes = entries.map((entry) => ({ hash: entry.hash, entries: [entry] }));
  for (let level = 1; nodes.length > 1; level++) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i], right = nodes[i + 1];
      const prefix = (level * 2).toString(16).padStart(2, "0") +
        (2 ** (level + 1)).toString(16).padStart(2, "0") + "02";
      for (const entry of left.entries) {
        (entry.existence.fields[3] as Data[]).push(
          record(1n, prefix + "20", "20" + right.hash),
        );
      }
      for (const entry of right.entries) {
        (entry.existence.fields[3] as Data[]).push(
          record(1n, prefix + "20" + left.hash + "20", ""),
        );
      }
      next.push({
        hash: await sha256(prefix + "20" + left.hash + "20" + right.hash),
        entries: [...left.entries, ...right.entries],
      });
    }
    nodes = next;
  }
  const innerRoot = nodes[0].hash;
  const root = await sha256(
    "0003" + fromText("ibc") + "20" + await sha256(innerRoot),
  );
  for (const entry of entries) {
    entry.outer.fields[1] = innerRoot;
    proofs.set(entry.sequence, { height, proof: entry.proof });
  }
  cs.fields[6] = height;
  state.fields[1] = new Map([[
    height,
    record(BigInt(emulator.now()) * 1_000_000n, "00".repeat(32), record(root)),
  ]]);
  state.fields[2] = new Map([[height, 0n]]);
  state.fields[3] = new Map([[height, 0n]]);
  context.client.datum = encode(client);

  async function wallet() {
    const account = generateEmulatorAccount({ lovelace: 300_000_000n });
    seed(account.address, account.assets, Data.void());
    seed(account.address, { lovelace: 5_000_000n }, Data.void());
    const clock = { ...SLOT_CONFIG_NETWORK.Custom };
    const lucid = await Lucid(emulator, "Custom");
    SLOT_CONFIG_NETWORK.Custom = clock;
    lucid.selectWallet.fromSeed(account.seedPhrase);
    // uplc 0.2.23 mishandles the 350-entry model (bitwise builtins receive
    // prohibitive default costs). Its supported 297-entry prefix has exactly
    // the same ledger costs for the builtins used here. Only evaluation uses
    // this projection. Transaction construction keeps all 350 entries.
    const evaluationModels = createCostModels({
      ...emulator.protocolParameters.costModels,
      PlutusV3: Object.fromEntries(
        parameters.plutusV3CostModel.slice(0, 297).map((
          cost,
          index,
        ) => [String(index), cost]),
      ),
    });
    isolateEvaluation(lucid, emulator, evaluationModels.to_cbor_bytes());
    return lucid;
  }

  async function admit(count: number) {
    const users = await Promise.all(
      Array.from({ length: count }, () => wallet()),
    );
    const hashes: string[] = [];
    for (const user of users) {
      const tx = await buildTransferIntent(user, deployment, {
        amount: 2_000_000n,
        receiver: "cosmos1receiver",
        timeoutTimestamp: BigInt(emulator.now() + 3_600_000) * 1_000_000n,
      });
      const signed = await (await tx.complete()).sign.withWallet().complete();
      // No protocol state input is used to admit a user request.
      const inputs = signed.toTransaction().body().inputs();
      for (let index = 0; index < inputs.len(); index++) {
        const ref = inputs.get(index);
        const [input] = await emulator.getUtxosByOutRef([{
          txHash: ref.transaction_id().to_hex(),
          outputIndex: Number(ref.index()),
        }]);
        assert(input.address === await user.wallet().address());
      }
      hashes.push(await signed.submit());
    }
    emulator.awaitBlock();
    const intents = (await fixture.lucid.utxosAt(guardAddress)).filter((u) =>
      hashes.includes(u.txHash)
    );
    assert(intents.length === count);
    return { intents, users };
  }
  return { ...fixture, deployment, wallet, admit, proofs };
}

export async function signMeasured(
  lucid: LucidEvolution,
  tx: TxBuilder,
  label: string,
) {
  const completed = await completeTransaction(tx);
  const signed = await completed.sign.withWallet().complete();
  const redeemers = signed.toTransaction().witness_set().redeemers();
  assert(redeemers, "compiled script execution is required");
  const units = CML.compute_total_ex_units(redeemers);
  const bytes = signed.toCBOR().length / 2;
  const limits = lucid.config().protocolParameters!;
  assert(
    bytes <= limits.maxTxSize,
    `${label}: ${bytes} bytes exceeds ${limits.maxTxSize}`,
  );
  assert(units.mem() <= limits.maxTxExMem, `${label}: memory budget exceeded`);
  assert(units.steps() <= limits.maxTxExSteps, `${label}: CPU budget exceeded`);
  console.log(
    `${label}: ${bytes} bytes, ${units.mem()} memory, ${units.steps()} CPU`,
  );
  return signed;
}

export function snapshot(
  fixture: Awaited<ReturnType<typeof packetLaneFixture>>,
) {
  const { emulator } = fixture;
  const saved = structuredClone({
    ledger: emulator.ledger,
    mempool: emulator.mempool,
    chain: emulator.chain,
    datumTable: emulator.datumTable,
    blockHeight: emulator.blockHeight,
    slot: emulator.slot,
    time: emulator.time,
  });
  return () => Object.assign(emulator, structuredClone(saved));
}
