import {
  Constr,
  credentialToAddress,
  Data,
  fromHex,
  fromText,
  getAddressDetails,
  type LucidEvolution,
  toHex,
  toText,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  liquidityTokenName,
  packetLane,
  packetLaneTokenName,
  sendSequencerTokenName,
} from "../../../packages/cardano-ibc-tx-builder/src/packet-lanes.ts";
import { stringifyIcs20PacketData } from "../../../packages/cardano-ibc-tx-builder/src/ics20-json-codec.ts";
import { DeploymentIbcTree } from "./deployment.ts";

export const record = (...fields: Data[]) => new Constr(0, fields);
export const variant = (index: number, ...fields: Data[]) =>
  new Constr(index, fields);
export const encode = (data: Data) => Data.to(data);
export const outRef = (utxo: UTxO) =>
  record(utxo.txHash, BigInt(utxo.outputIndex));
const copy = (data: Constr<Data>) => Data.from(encode(data)) as Constr<Data>;
export const sha256 = async (hex: string) =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(fromHex(hex))),
    ),
  );

export interface PacketLaneDeployment {
  batchPolicy: string;
  batchAddress: string;
  guardAddress: string;
  statePolicy: string;
  laneCount: number;
  channel: UTxO;
  connection: UTxO;
  client: UTxO;
  scripts: UTxO[];
}

export interface FundedTransfer {
  amount: bigint;
  receiver: string;
  timeoutTimestamp: bigint;
  assetUnit?: string;
  reserve?: bigint;
  memo?: string;
}

function decode(utxo: UTxO): Constr<Data> {
  if (!utxo.datum) throw new Error("Expected inline datum");
  const data = Data.from(utxo.datum);
  if (!(data instanceof Constr) || data.index !== 0) {
    throw new Error("Unexpected datum");
  }
  return data;
}

function channelIdentity(deployment: PacketLaneDeployment) {
  const channel = decode(deployment.channel);
  const token = channel.fields[2] as Constr<Data>;
  const channelId = `channel-${toText(String(token.fields[1]).slice(48))}`;
  const port = toText(String(channel.fields[1]));
  const state = channel.fields[0] as Constr<Data>;
  const end = state.fields[0] as Constr<Data>;
  const counterparty = end.fields[2] as Constr<Data>;
  return { port, channelId, counterparty };
}

/** Admission spends only the user's funding. It has no protocol state inputs. */
export async function buildTransferIntent(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  request: FundedTransfer,
) {
  const { port, channelId } = channelIdentity(deployment);
  const owner =
    getAddressDetails(await lucid.wallet().address()).paymentCredential;
  if (owner?.type !== "Key") {
    throw new Error("Intent owner must be a payment key");
  }
  const unit = request.assetUnit ?? "lovelace";
  if (
    unit !== "lovelace" &&
    (!/^[0-9a-f]{56,120}$/.test(unit) || unit.length % 2 !== 0)
  ) throw new Error("Invalid native asset unit");
  const amount = request.amount;
  const reserve = request.reserve ?? 3_000_000n;
  if (amount <= 0n || reserve <= 0n || request.timeoutTimestamp <= 0n) {
    throw new Error("Invalid funded intent");
  }
  const data = {
    amount: amount.toString(),
    denom: unit === "lovelace" ? fromText(unit) : unit,
    memo: request.memo ?? "",
    receiver: request.receiver,
    sender: owner.hash,
  };
  stringifyIcs20PacketData(data);
  const intent = record(
    fromText(port),
    fromText(channelId),
    owner.hash,
    record(
      fromText(data.denom),
      fromText(data.amount),
      fromText(data.sender),
      fromText(data.receiver),
      fromText(data.memo),
    ),
    request.timeoutTimestamp,
  );
  const assets: Record<string, bigint> = { lovelace: reserve };
  assets[unit] = (assets[unit] ?? 0n) + amount;
  return lucid.newTx().pay.ToContract(deployment.guardAddress, {
    kind: "inline",
    value: encode(intent),
  }, assets);
}

export async function laneTree(
  datum: Constr<Data>,
): Promise<DeploymentIbcTree> {
  const port = toText(String(datum.fields[0]));
  const channel = toText(String(datum.fields[1]));
  const tree = new DeploymentIbcTree();
  for (const [sequence, value] of datum.fields[6] as Map<bigint, string>) {
    tree.set(
      `commitments/ports/${port}/channels/${channel}/sequences/${sequence}`,
      value,
    );
  }
  for (const sequence of datum.fields[7] as bigint[]) {
    tree.set(
      `receipts/ports/${port}/channels/${channel}/sequences/${sequence}`,
      "01",
    );
  }
  for (const [sequence, value] of datum.fields[8] as Map<bigint, string>) {
    tree.set(
      `acks/ports/${port}/channels/${channel}/sequences/${sequence}`,
      value,
    );
  }
  if (await tree.getRoot() !== datum.fields[5]) {
    throw new Error("Lane datum does not match its root");
  }
  return tree;
}

async function requireUnspent(lucid: LucidEvolution, inputs: UTxO[]) {
  const actual = await lucid.utxosByOutRef(
    inputs.map(({ txHash, outputIndex }) => ({ txHash, outputIndex })),
  );
  const refs = new Set(actual.map((u) => `${u.txHash}#${u.outputIndex}`));
  if (inputs.some((u) => !refs.has(`${u.txHash}#${u.outputIndex}`))) {
    throw new Error(
      "State or intent input is no longer unspent, rebuild from included state",
    );
  }
}

/** Read current included outputs on every build. Preparing a transaction never
 * publishes speculative roots or sequences, so retries after rollback reload
 * the ledger's state instead of advancing a process-local counter. */
export async function buildPacketSendBatch(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  intents: UTxO[],
  validFrom: number,
  validTo: number,
) {
  if (intents.length < 1 || intents.length > 2) {
    throw new Error("Send batch requires one or two intents");
  }
  if (
    new Set(intents.map((u) => `${u.txHash}#${u.outputIndex}`)).size !==
      intents.length
  ) throw new Error("Duplicate intent");
  await requireUnspent(lucid, intents);
  const { port, channelId, counterparty } = channelIdentity(deployment);
  const sequencer = await lucid.utxoByUnit(
    deployment.statePolicy + sendSequencerTokenName(port, channelId),
  );
  const oldSequence = decode(sequencer);
  const firstSequence = oldSequence.fields[3] as bigint;
  const packets: Constr<Data>[] = [];
  const lanes = new Map<
    number,
    {
      input: UTxO;
      datum: Constr<Data>;
      tree: DeploymentIbcTree;
      updates: Constr<Data>[];
    }
  >();
  const escrows: { datum: Constr<Data>; assets: Record<string, bigint> }[] = [];
  const mint: Record<string, bigint> = {};
  for (const [index, input] of intents.entries()) {
    const intent = decode(input);
    if (
      intent.fields[0] !== fromText(port) ||
      intent.fields[1] !== fromText(channelId)
    ) throw new Error("Intent belongs to another channel");
    const fields = (intent.fields[3] as Constr<Data>).fields as string[];
    const data = {
      denom: toText(fields[0]),
      amount: toText(fields[1]),
      sender: toText(fields[2]),
      receiver: toText(fields[3]),
      memo: toText(fields[4]),
    };
    const timeout = intent.fields[4] as bigint;
    if (timeout <= BigInt(validTo) * 1_000_000n) {
      throw new Error("Intent timeout is too early for batch validity");
    }
    const payload = fromText(stringifyIcs20PacketData(data));
    const sequence = firstSequence + BigInt(index);
    const packet = record(
      sequence,
      fromText(port),
      fromText(channelId),
      ...counterparty.fields,
      payload,
      record(0n, 0n),
      timeout,
    );
    packets.push(packet);
    const commitment = await sha256(
      timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
        await sha256(payload),
    );
    const laneId = packetLane(port, channelId, sequence, deployment.laneCount);
    let lane = lanes.get(laneId);
    if (!lane) {
      const utxo = await lucid.utxoByUnit(
        deployment.statePolicy +
          packetLaneTokenName(port, channelId, laneId, deployment.laneCount),
      );
      const datum = copy(decode(utxo));
      lane = { input: utxo, datum, tree: await laneTree(datum), updates: [] };
      lanes.set(laneId, lane);
    }
    const key =
      `commitments/ports/${port}/channels/${channelId}/sequences/${sequence}`;
    const siblings = await lane.tree.getSiblings(key);
    lane.tree.set(key, commitment);
    lane.updates.push(record(variant(0, packet), [siblings]));
    (lane.datum.fields[6] as Map<bigint, string>).set(sequence, commitment);
    const token = liquidityTokenName(
      port,
      channelId,
      data.denom,
      input.txHash,
      input.outputIndex,
    );
    const unit = data.denom === fromText("lovelace") ? "lovelace" : data.denom;
    const escrow = record(
      fromText(port),
      fromText(channelId),
      fields[0],
      unit === "lovelace" ? "" : unit.slice(0, 56),
      unit === "lovelace" ? "" : unit.slice(56),
      outRef(input),
      BigInt(data.amount),
      record(variant(0, String(intent.fields[2])), variant(1)),
    );
    escrows.push({
      datum: escrow,
      assets: { ...input.assets, [deployment.batchPolicy + token]: 1n },
    });
    mint[deployment.batchPolicy + token] = 1n;
  }
  const ordered = [...lanes.entries()].sort(([a], [b]) => a - b).map((
    [, lane],
  ) => lane);
  const laneUpdates = ordered.map((lane) =>
    record(outRef(lane.input), lane.updates)
  );
  const operation = variant(
    0,
    outRef(sequencer),
    intents.map(outRef),
    packets,
    laneUpdates,
  );
  const nextSequence = copy(oldSequence);
  nextSequence.fields[2] = (oldSequence.fields[2] as bigint) + 1n;
  nextSequence.fields[3] = firstSequence + BigInt(intents.length);
  let tx = lucid.newTx().readFrom([
    deployment.channel,
    deployment.connection,
    deployment.client,
    ...deployment.scripts,
  ])
    .collectFrom(intents, encode(variant(0)))
    .collectFrom([sequencer], encode(variant(2)))
    .mintAssets(mint, encode(operation))
    .pay.ToContract(deployment.guardAddress, {
      kind: "inline",
      value: encode(nextSequence),
    }, sequencer.assets)
    .validFrom(validFrom).validTo(validTo);
  for (const lane of ordered) {
    lane.datum.fields[4] = (lane.datum.fields[4] as bigint) + 1n;
    lane.datum.fields[5] = await lane.tree.getRoot();
    // Aiken's map insertion orders sequences. Preserve that representation.
    lane.datum.fields[6] = new Map(
      [...(lane.datum.fields[6] as Map<bigint, string>)].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
      ),
    );
    tx = tx.collectFrom([lane.input], encode(variant(3)))
      .pay.ToContract(deployment.guardAddress, {
        kind: "inline",
        value: encode(lane.datum),
      }, lane.input.assets);
  }
  for (const escrow of escrows) {
    tx = tx.pay.ToContract(deployment.batchAddress, {
      kind: "inline",
      value: encode(escrow.datum),
    }, escrow.assets);
  }
  await requireUnspent(lucid, [
    sequencer,
    ...ordered.map((lane) => lane.input),
    deployment.channel,
    deployment.connection,
    deployment.client,
  ]);
  return {
    tx,
    packets,
    operation,
    inputs: [sequencer, ...intents, ...ordered.map((lane) => lane.input)],
    escrows,
  };
}

async function buildPacketCompletion(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  packet: Constr<Data>,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  validFrom: number,
  validTo: number,
  liquidity?: UTxO[],
) {
  const { port, channelId } = channelIdentity(deployment);
  const sequence = packet.fields[0] as bigint;
  const laneId = packetLane(port, channelId, sequence, deployment.laneCount);
  const input = await lucid.utxoByUnit(
    deployment.statePolicy +
      packetLaneTokenName(port, channelId, laneId, deployment.laneCount),
  );
  const datum = copy(decode(input));
  const tree = await laneTree(datum);
  const key =
    `commitments/ports/${port}/channels/${channelId}/sequences/${sequence}`;
  const siblings = await tree.getSiblings(key);
  tree.set(key, "");
  if (!(datum.fields[6] as Map<bigint, string>).delete(sequence)) {
    throw new Error("Packet commitment is absent");
  }
  datum.fields[4] = (datum.fields[4] as bigint) + 1n;
  datum.fields[5] = await tree.getRoot();
  const update = record(outRef(input), [
    record(variant(2, packet), [siblings]),
  ]);
  let operation = variant(1, packet, proofHeight, proof, update);
  const mint: Record<string, bigint> = {
    [deployment.batchPolicy + fromText("acknowledge")]: 1n,
  };
  let tx = lucid.newTx().readFrom([
    deployment.channel,
    deployment.connection,
    deployment.client,
    ...deployment.scripts,
  ])
    .collectFrom([input], encode(variant(3)))
    .pay.ToContract(deployment.guardAddress, {
      kind: "inline",
      value: encode(datum),
    }, input.assets)
    .validFrom(validFrom).validTo(validTo);
  if (liquidity) {
    await requireUnspent(lucid, liquidity);
    const data = JSON.parse(toText(String(packet.fields[5])));
    const fields = record(
      ...[data.denom, data.amount, data.sender, data.receiver, data.memo ?? ""]
        .map(fromText),
    );
    operation = variant(
      2,
      packet,
      fields,
      proofHeight,
      proof,
      update,
      liquidity.map(outRef),
    );
    delete mint[deployment.batchPolicy + fromText("acknowledge")];
    mint[deployment.batchPolicy + fromText("timeout")] = 1n;
    let total = 0n;
    for (const escrow of liquidity) {
      const old = decode(escrow);
      if (
        old.fields[0] !== fromText(port) ||
        old.fields[1] !== fromText(channelId) ||
        old.fields[2] !== fields.fields[0]
      ) throw new Error("Wrong liquidity identity");
      const amount = old.fields[6] as bigint;
      total += amount;
      const token = liquidityUnit(escrow, deployment);
      mint[token] = -1n;
      tx = tx.collectFrom([escrow], Data.void());
      tx = refundReserve(tx, lucid, deployment, escrow);
    }
    if (total !== BigInt(data.amount)) {
      throw new Error("Full-drain liquidity must exactly cover the refund");
    }
    const unit = data.denom === fromText("lovelace") ? "lovelace" : data.denom;
    const recipient = credentialToAddress(lucid.config().network!, {
      type: "Key",
      hash: data.sender,
    });
    tx = tx.pay.ToAddressWithData(recipient, {
      kind: "inline",
      value: encode(record(fromText(port), fromText(channelId), sequence)),
    }, { [unit]: total });
  }
  await requireUnspent(lucid, [
    input,
    deployment.channel,
    deployment.connection,
    deployment.client,
  ]);
  return { tx: tx.mintAssets(mint, encode(operation)), input };
}

export const buildPacketAcknowledgement = (
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  packet: Constr<Data>,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  validFrom: number,
  validTo: number,
) =>
  buildPacketCompletion(
    lucid,
    deployment,
    packet,
    proofHeight,
    proof,
    validFrom,
    validTo,
  );

/** Full-drain timeout refunds. Partial releases require a separate selection strategy. */
export const buildPacketTimeout = (
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  packet: Constr<Data>,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  liquidity: UTxO[],
  validFrom: number,
  validTo: number,
) =>
  buildPacketCompletion(
    lucid,
    deployment,
    packet,
    proofHeight,
    proof,
    validFrom,
    validTo,
    liquidity,
  );

function liquidityUnit(input: UTxO, deployment: PacketLaneDeployment) {
  const units = Object.entries(input.assets).filter(([unit, quantity]) =>
    unit.startsWith(deployment.batchPolicy) && quantity === 1n
  );
  if (units.length !== 1) throw new Error("Expected one liquidity identity");
  return units[0][0];
}

function refundReserve(
  tx: ReturnType<LucidEvolution["newTx"]>,
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  input: UTxO,
) {
  const old = decode(input);
  const reserve = input.assets.lovelace -
    (old.fields[3] === "" && old.fields[4] === ""
      ? old.fields[6] as bigint
      : 0n);
  const owner = old.fields[7] as Constr<Data>;
  const credential = owner.fields[0] as Constr<Data>;
  if (credential.index !== 0 || (owner.fields[1] as Constr<Data>).index !== 1) {
    throw new Error("Expected an enterprise reserve owner");
  }
  const address = credentialToAddress(lucid.config().network!, {
    type: "Key",
    hash: String(credential.fields[0]),
  });
  const token = liquidityUnit(input, deployment).slice(56);
  return tx.pay.ToAddressWithData(address, {
    kind: "inline",
    value: encode(record(deployment.batchPolicy, token)),
  }, { lovelace: reserve });
}

/** Retire empty outputs, or consolidate into the first identity without releasing principal. */
export async function buildLiquidityRetirement(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  inputs: UTxO[],
  consolidate = false,
) {
  if (inputs.length < (consolidate ? 2 : 1) || inputs.length > 5) {
    throw new Error("Invalid retirement input count");
  }
  if (
    new Set(inputs.map((u) => `${u.txHash}#${u.outputIndex}`)).size !==
      inputs.length
  ) throw new Error("Duplicate liquidity input");
  await requireUnspent(lucid, inputs);
  let tx = lucid.newTx().readFrom(deployment.scripts).collectFrom(
    inputs,
    Data.void(),
  );
  const mint: Record<string, bigint> = {};
  const survivor = copy(decode(inputs[0]));
  let total = 0n;
  for (const [index, input] of inputs.entries()) {
    const datum = decode(input);
    if (
      encode(datum.fields.slice(0, 5)) !== encode(survivor.fields.slice(0, 5))
    ) throw new Error("Cannot consolidate different assets or channels");
    const amount = datum.fields[6] as bigint;
    total += amount;
    if (!consolidate && amount !== 0n) {
      throw new Error("Only empty liquidity can retire without a packet proof");
    }
    if (consolidate && index === 0) continue;
    mint[liquidityUnit(input, deployment)] = -1n;
    tx = refundReserve(tx, lucid, deployment, input);
  }
  if (consolidate) {
    const unit = survivor.fields[3] === "" && survivor.fields[4] === ""
      ? "lovelace"
      : String(survivor.fields[3]) + String(survivor.fields[4]);
    const assets = { ...inputs[0].assets };
    assets[unit] = (assets[unit] ?? 0n) + total -
      (survivor.fields[6] as bigint);
    survivor.fields[6] = total;
    tx = tx.pay.ToContract(deployment.batchAddress, {
      kind: "inline",
      value: encode(survivor),
    }, assets);
  }
  const operation = consolidate
    ? variant(4, inputs.map(outRef), outRef(inputs[0]))
    : variant(3, inputs.map(outRef));
  return tx.mintAssets(mint, encode(operation));
}

export async function buildTransferIntentCancellation(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  intent: UTxO,
) {
  await requireUnspent(lucid, [intent]);
  const owner =
    getAddressDetails(await lucid.wallet().address()).paymentCredential;
  if (owner?.type !== "Key" || owner.hash !== decode(intent).fields[2]) {
    throw new Error("Only the intent owner can cancel");
  }
  // The owner's signature authorizes the normal wallet change and fees.
  return lucid.newTx().readFrom(deployment.scripts)
    .collectFrom([intent], encode(variant(1))).addSignerKey(owner.hash);
}
