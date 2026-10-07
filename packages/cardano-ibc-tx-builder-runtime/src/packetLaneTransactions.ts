import { sha256 as hash256 } from "@noble/hashes/sha256";
import { blake2b } from "@noble/hashes/blake2b";
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
} from "@cardano-ibc/tx-builder/dist/packet-lanes";
import { stringifyIcs20PacketData } from "@cardano-ibc/tx-builder/dist/ics20-json-codec";
import { ICS23MerkleTree } from "./ics23MerkleTree.ts";
class PacketLaneTree {
  readonly tree = new ICS23MerkleTree();
  set(key: string, value: string) {
    this.tree.set(key, value);
  }
  getRoot() {
    return this.tree.getRoot();
  }
  getSiblings(key: string) {
    return this.tree.getSiblings(key).map((value) => value.toString("hex"));
  }
}

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
  operations: Record<string, { policy: string; reference: UTxO }>;
  proofVerifier: { policy: string; reference: UTxO };
  batchPolicy: string;
  batchAddress: string;
  guardAddress: string;
  statePolicy: string;
  laneCount: number;
  voucherPolicy?: string;
  historyWitness?: Data;
  channel: UTxO;
  connection: UTxO;
  client: UTxO;
  scripts: UTxO[];
}

const operationNames = [
  "send",
  "acknowledge",
  "timeout",
  "retire",
  "retire",
  "receive",
  "reject",
  "prune",
  "timeout_on_close",
];

export const MAX_LANE_BALANCES = 8;

/** Cancel completed cross-lane obligations, or redistribute keys to admit a return.
 * Only these two lanes are spent. Packet roots, replay state and reserves are preserved.
 * leftDenoms can place a returning asset in its receive lane even when both maps are full.
 */
export async function buildPacketBalanceCompaction(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  leftLane: number,
  rightLane: number,
  leftDenoms?: string[],
) {
  if (leftLane === rightLane) {
    throw new Error("Compaction requires different lanes");
  }
  const { port, channelId } = channelIdentity(deployment);
  const inputs = await Promise.all(
    [leftLane, rightLane].map((lane) =>
      lucid.utxoByUnit(
        deployment.statePolicy +
          packetLaneTokenName(port, channelId, lane, deployment.laneCount),
      )
    ),
  );
  const datums = inputs.map((input) => copy(decode(input)));
  if (datums.some((datum) => (datum.fields[6] as Map<Data, Data>).size > 0)) {
    throw new Error(
      "Settle outstanding sends before compacting lane accounting",
    );
  }
  const totals = new Map<string, bigint>();
  for (const datum of datums) {
    for (const [key, amount] of datum.fields[11] as Map<string, bigint>) {
      totals.set(key, (totals.get(key) ?? 0n) + amount);
    }
  }
  const entries = [...totals].filter(([, amount]) => amount !== 0n)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const preferred = leftDenoms?.map((denom) =>
    toHex(hash256(new TextEncoder().encode(denom)))
  );
  const leftKeys = new Set(
    preferred ?? entries.slice(0, MAX_LANE_BALANCES).map(([key]) => key),
  );
  for (const [i, datum] of datums.entries()) {
    const balances = new Map(
      entries.filter(([key]) => leftKeys.has(key) === (i === 0)),
    );
    if (balances.size > MAX_LANE_BALANCES) {
      throw new Error("Redistribution exceeds lane accounting capacity");
    }
    datum.fields[11] = balances;
    datum.fields[4] = (datum.fields[4] as bigint) + 1n;
  }
  let tx = lucid.newTx().readFrom(
    deployment.scripts.filter((u) => u.scriptRef),
  );
  for (const [i, input] of inputs.entries()) {
    tx = tx.collectFrom([input], encode(variant(5, outRef(inputs[1 - i]))))
      .pay.ToContract(input.address, {
        kind: "inline",
        value: encode(datums[i]),
      }, input.assets);
  }
  return { tx, inputs, datums };
}

export class PacketLaneAccountingCapacityError extends Error {
  constructor() {
    super(
      "Packet lane accounting is full. Settle outstanding sends, then compact or redistribute balances before retrying.",
    );
    this.name = "PacketLaneAccountingCapacityError";
  }
}

function addLaneBalance(datum: Constr<Data>, denom: string, delta: bigint) {
  const balances = datum.fields[11] as Map<string, bigint>;
  const key = toHex(hash256(new TextEncoder().encode(denom)));
  const amount = (balances.get(key) ?? 0n) + delta;
  if (amount === 0n && (datum.fields[6] as Map<Data, Data>).size === 0) {
    balances.delete(key);
  } else balances.set(key, amount);
  if (balances.size > MAX_LANE_BALANCES) {
    throw new PacketLaneAccountingCapacityError();
  }
  datum.fields[11] = new Map(
    [...balances].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  );
}

async function authorizeOperation(
  tx: ReturnType<LucidEvolution["newTx"]>,
  deployment: PacketLaneDeployment,
  operation: Constr<Data>,
  mint: Record<string, bigint>,
) {
  const authorized = encode(
    record(
      decode(deployment.channel).fields[2],
      operation,
      deployment.historyWitness
        ? variant(0, deployment.historyWitness)
        : variant(1),
    ),
  );
  tx = tx.mintAssets(mint, authorized);
  const names = [operationNames[operation.index]];
  if ([0, 1, 2, 5, 6, 8].includes(operation.index)) {
    names.push(operation.index === 0 ? "send_funds" : "funds");
  }
  for (const name of names) {
    const validator = deployment.operations[name];
    if (!validator) throw new Error(`Missing packet operation policy: ${name}`);
    tx = tx.readFrom([validator.reference]).mintAssets({
      [validator.policy]: 1n,
    }, Data.void());
  }
  if (![0, 3, 4].includes(operation.index)) {
    const proof = await packetProof(deployment, operation);
    tx = tx.readFrom([deployment.proofVerifier.reference]).mintAssets({
      [deployment.proofVerifier.policy]: 1n,
    }, encode(record(proof, variant(1))));
  }
  return tx;
}

function mapAtHeight(map: Data, height: Data): Data {
  if (!(map instanceof Map)) throw new Error("Invalid client consensus map");
  for (const [key, value] of map) {
    if (encode(key) === encode(height)) return value;
  }
  throw new Error("Client does not contain the requested proof height");
}

// The operation validator compares this envelope to the authenticated client,
// connection and packet. The verifier performs the ICS-23 computation.
async function packetProof(
  deployment: PacketLaneDeployment,
  op: Constr<Data>,
): Promise<Constr<Data>> {
  const receive = op.index === 5;
  const prune = op.index === 7;
  const timeout = op.index === 2 || op.index === 8;
  const heightIndex = op.index === 1 || prune ? 1 : op.index === 6 ? 3 : 2;
  const height = op.fields[heightIndex];
  const proof = op.fields[heightIndex + 1];
  const client = decode(deployment.client).fields[0] as Constr<Data>;
  const connection = decode(deployment.connection).fields[0] as Constr<Data>;
  const counterparty = connection.fields[3] as Constr<Data>;
  const prefix = (counterparty.fields[2] as Constr<Data>).fields[0];
  let consensus: Data, processedTime: Data, processedHeight: Data;
  if (deployment.historyWitness) {
    const history = (deployment.historyWitness as Constr<Data>)
      .fields[0] as Constr<Data>;
    if (encode(history.fields[1]) !== encode(height)) {
      throw new Error("History witness height mismatch");
    }
    [consensus, processedTime, processedHeight] = history.fields.slice(2, 5);
  } else {
    consensus = mapAtHeight(client.fields[1], height);
    processedTime = mapAtHeight(client.fields[2], height);
    processedHeight = mapAtHeight(client.fields[3], height);
  }
  const delay = connection.fields[4] as bigint;
  const common = [
    client.fields[0],
    consensus,
    height,
    processedTime,
    processedHeight,
    delay,
    (delay + 3_999_999_999n) / 4_000_000_000n,
  ];
  const channel = channelIdentity(deployment);
  const packet = op.fields[0] as Constr<Data>;
  const port = prune
    ? channel.counterparty.fields[0]
    : packet.fields[receive ? 1 : 3];
  const channelId = prune
    ? channel.counterparty.fields[1]
    : packet.fields[receive ? 2 : 4];
  const sequence = prune ? op.fields[0] : packet.fields[0];
  const kind = prune || receive ? "commitments" : timeout ? "receipts" : "acks";
  const path = record([
    prefix,
    fromText(
      `${kind}/ports/${toText(String(port))}/channels/${
        toText(String(channelId))
      }/sequences/${sequence}`,
    ),
  ]);
  if (op.index === 8) {
    const end = (decode(deployment.channel).fields[0] as Constr<Data>)
      .fields[0] as Constr<Data>;
    const counterpart = protobufBytes(1, String(packet.fields[1])) +
      protobufBytes(2, String(packet.fields[2]));
    const closedChannel = "08041001" + protobufBytes(3, counterpart) +
      protobufBytes(4, String(counterparty.fields[1])) +
      protobufBytes(5, String(end.fields[4]));
    const closePath = record([
      prefix,
      fromText(
        `channelEnds/ports/${toText(String(port))}/channels/${
          toText(String(channelId))
        }`,
      ),
    ]);
    const membership = record(
      ...common.slice(0, 5),
      0n,
      0n,
      op.fields[6],
      closePath,
      closedChannel,
    );
    return variant(4, [membership], [record(...common, proof, path)]);
  }
  if (timeout || prune) return variant(1, ...common, proof, path);
  const value = receive
    ? await sha256(
      (packet.fields[7] as bigint).toString(16).padStart(16, "0") +
        ((packet.fields[6] as Constr<Data>).fields[0] as bigint).toString(16)
          .padStart(16, "0") +
        ((packet.fields[6] as Constr<Data>).fields[1] as bigint).toString(16)
          .padStart(16, "0") +
        await sha256(String(packet.fields[5])),
    )
    : await sha256(
      fromText(
        op.index === 6
          ? `{"error":"${toText(String(op.fields[2]))}"}`
          : '{"result":"AQ=="}',
      ),
    );
  return variant(0, ...common, proof, path, value);
}

function protobufBytes(field: number, hex: string): string {
  let length = hex.length / 2;
  let encoded = "";
  do {
    const next = length % 128;
    length = Math.floor(length / 128);
    encoded += (next | (length ? 128 : 0)).toString(16).padStart(2, "0");
  } while (length);
  return (field * 8 + 2).toString(16).padStart(2, "0") + encoded + hex;
}

export interface FundedTransfer {
  amount: bigint;
  receiver: string;
  timeoutTimestamp: bigint;
  assetUnit?: string;
  reserve?: bigint;
  memo?: string;
  fullDenom?: string;
}

function decode(utxo: UTxO): Constr<Data> {
  if (!utxo.datum) throw new Error("Expected inline datum");
  const data = Data.from(utxo.datum);
  if (!(data instanceof Constr) || data.index !== 0) {
    throw new Error("Unexpected datum");
  }
  return data;
}

function channelIdentity(deployment: Pick<PacketLaneDeployment, "channel">) {
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
  deployment: Pick<PacketLaneDeployment, "channel" | "guardAddress">,
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
  if (
    amount <= 0n || reserve <= 0n || request.timeoutTimestamp <= 0n ||
    request.timeoutTimestamp > 0xffffffffffffffffn
  ) {
    throw new Error("Invalid funded intent");
  }
  const data = {
    amount: amount.toString(),
    denom: request.fullDenom ?? (unit === "lovelace" ? fromText(unit) : unit),
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
): Promise<PacketLaneTree> {
  const port = toText(String(datum.fields[0]));
  const channel = toText(String(datum.fields[1]));
  const tree = new PacketLaneTree();
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
      tree: PacketLaneTree;
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
    addLaneBalance(
      lane.datum,
      data.denom,
      BigInt(data.amount) *
        (data.denom.startsWith(`${port}/${channelId}/`) ? -1n : 1n),
    );
    if (data.denom.startsWith(`${port}/${channelId}/`)) {
      const unit = localAssetUnit(data.denom, deployment);
      mint[unit] = (mint[unit] ?? 0n) - BigInt(data.amount);
      mint[deployment.batchPolicy + fromText("send")] = 1n;
      continue;
    }
    const token = liquidityTokenName(
      port,
      channelId,
      data.denom,
      input.txHash,
      input.outputIndex,
    );
    const unit = localAssetUnit(data.denom, deployment);
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
  if (
    deployment.voucherPolicy &&
    Object.keys(mint).some((unit) => unit.startsWith(deployment.voucherPolicy!))
  ) {
    const burns = Object.fromEntries(
      Object.entries(mint).filter(([unit]) =>
        unit.startsWith(deployment.voucherPolicy!)
      ),
    );
    // Minting policies require separate redeemers. The batch policy only owns liquidity identities.
    tx = tx.mintAssets(burns, encode(variant(4)));
    for (const input of intents) {
      const intent = decode(input);
      const data = intent.fields[3] as Constr<Data>;
      if (!toText(String(data.fields[0])).startsWith(`${port}/${channelId}/`)) {
        continue;
      }
      tx = tx.pay.ToAddressWithData(
        credentialToAddress(lucid.config().network!, {
          type: "Key",
          hash: String(intent.fields[2]),
        }),
        { kind: "inline", value: encode(outRef(input)) },
        { lovelace: input.assets.lovelace },
      );
    }
  }
  await requireUnspent(lucid, [
    sequencer,
    ...ordered.map((lane) => lane.input),
    deployment.channel,
    deployment.connection,
    deployment.client,
  ]);
  tx = await authorizeOperation(
    tx,
    deployment,
    operation,
    Object.fromEntries(
      Object.entries(mint).filter(([unit]) =>
        unit.startsWith(deployment.batchPolicy)
      ),
    ),
  );
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
  rejection?: string,
  proofClose?: Constr<Data>,
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
  if (liquidity) {
    const data = JSON.parse(toText(String(packet.fields[5])));
    addLaneBalance(
      datum,
      data.denom,
      BigInt(data.amount) *
        (data.denom.startsWith(`${port}/${channelId}/`) ? 1n : -1n),
    );
  }
  if ((datum.fields[6] as Map<Data, Data>).size === 0) {
    datum.fields[11] = new Map(
      [...datum.fields[11] as Map<string, bigint>].filter(([, amount]) =>
        amount !== 0n
      ),
    );
  }
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
    if (proofClose) {
      operation = variant(
        8,
        packet,
        fields,
        proofHeight,
        proof,
        update,
        liquidity.map(outRef),
        proofClose,
      );
    }
    if (rejection !== undefined) {
      if (!rejection) throw new Error("Empty rejection acknowledgement");
      operation = variant(
        6,
        packet,
        fields,
        fromText(JSON.stringify(rejection).slice(1, -1)),
        proofHeight,
        proof,
        update,
        liquidity.map(outRef),
      );
      delete mint[deployment.batchPolicy + fromText("timeout")];
      mint[deployment.batchPolicy + fromText("reject")] = 1n;
    }
    if (data.denom.startsWith(`${port}/${channelId}/`)) {
      if (liquidity.length) {
        throw new Error("Voucher refund must not release escrow");
      }
      tx = voucherPayment(
        lucid,
        deployment,
        tx,
        port,
        channelId,
        sequence,
        data.denom,
        BigInt(data.amount),
        data.sender,
      );
    } else {
      tx = await releaseLiquidity(
        lucid,
        deployment,
        tx,
        mint,
        port,
        channelId,
        sequence,
        data.denom,
        BigInt(data.amount),
        data.sender,
        liquidity,
      );
    }
  }
  await requireUnspent(lucid, [
    input,
    deployment.channel,
    deployment.connection,
    deployment.client,
  ]);
  return {
    tx: await authorizeOperation(tx, deployment, operation, mint),
    input,
  };
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
  return await authorizeOperation(tx, deployment, operation, mint);
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

export async function buildPacketLaneInitialization(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  config: UTxO,
  registryAddress: string,
) {
  const { port, channelId } = channelIdentity(deployment);
  const registry = await lucid.utxoByUnit(
    deployment.statePolicy + fromText("ibc_packet_registry"),
  );
  const next = decode(registry).fields[0] as bigint;
  if (channelId !== `channel-${next}`) {
    throw new Error("Channels must initialize in creation order");
  }
  const mint: Record<string, bigint> = {
    [deployment.statePolicy + sendSequencerTokenName(port, channelId)]: 1n,
  };
  let tx = lucid.newTx().readFrom([
    config,
    deployment.channel,
    ...deployment.scripts,
  ])
    .collectFrom([registry], Data.void())
    .pay.ToContract(registryAddress, {
      kind: "inline",
      value: encode(record(next + 1n)),
    }, registry.assets)
    .pay.ToContract(deployment.guardAddress, {
      kind: "inline",
      value: encode(record(fromText(port), fromText(channelId), 0n, 1n)),
    }, {
      [deployment.statePolicy + sendSequencerTokenName(port, channelId)]: 1n,
    });
  for (let lane = 0; lane < deployment.laneCount; lane++) {
    const token = deployment.statePolicy +
      packetLaneTokenName(port, channelId, lane, deployment.laneCount);
    mint[token] = 1n;
    tx = tx.pay.ToContract(deployment.guardAddress, {
      kind: "inline",
      value: encode(
        record(
          fromText(port),
          fromText(channelId),
          BigInt(lane),
          BigInt(deployment.laneCount),
          0n,
          "00".repeat(32),
          new Map(),
          [],
          new Map(),
          record(0n, 0n),
          record(0n, 0n),
          new Map(),
        ),
      ),
    }, { [token]: 1n });
  }
  return tx.mintAssets(
    mint,
    encode(variant(1, decode(deployment.channel).fields[2])),
  );
}

/** Select and release independent deposits. A full drain returns its reserve and burns its identity. */
async function releaseLiquidity(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  tx: ReturnType<LucidEvolution["newTx"]>,
  mint: Record<string, bigint>,
  port: string,
  channel: string,
  sequence: bigint,
  denom: string,
  amount: bigint,
  recipient: string,
  inputs: UTxO[],
) {
  if (
    inputs.length < 1 || inputs.length > 5 ||
    new Set(inputs.map((u) => `${u.txHash}#${u.outputIndex}`)).size !==
      inputs.length
  ) {
    throw new Error("Invalid liquidity selection");
  }
  await requireUnspent(lucid, inputs);
  let remaining = amount;
  const unit = localAssetUnit(denom, deployment);
  for (const input of inputs) {
    const datum = copy(decode(input));
    if (
      datum.fields[0] !== fromText(port) ||
      datum.fields[1] !== fromText(channel) ||
      datum.fields[2] !== fromText(denom)
    ) {
      throw new Error("Liquidity belongs to another channel or denomination");
    }
    const available = datum.fields[6] as bigint;
    if (remaining <= 0n || available <= 0n) {
      throw new Error("Unused liquidity input");
    }
    const released = available < remaining ? available : remaining;
    remaining -= released;
    tx = tx.collectFrom([input], Data.void());
    if (released === available) {
      mint[liquidityUnit(input, deployment)] = -1n;
      tx = refundReserve(tx, lucid, deployment, input);
    } else {
      datum.fields[6] = available - released;
      tx = tx.pay.ToContract(deployment.batchAddress, {
        kind: "inline",
        value: encode(datum),
      }, {
        ...input.assets,
        [unit]: input.assets[unit] - released,
      });
    }
  }
  if (remaining !== 0n) throw new Error("Insufficient selected liquidity");
  return tx.pay.ToAddressWithData(
    credentialToAddress(lucid.config().network!, {
      type: "Key",
      hash: recipient,
    }),
    {
      kind: "inline",
      value: encode(record(fromText(port), fromText(channel), sequence)),
    },
    { [unit]: amount },
  );
}

export async function buildPacketReceive(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  packet: Constr<Data>,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  liquidity: UTxO[],
  validFrom: number,
  validTo: number,
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
  if ((datum.fields[7] as bigint[]).includes(sequence)) {
    throw new Error("Packet already received");
  }
  const receiptKey =
    `receipts/ports/${port}/channels/${channelId}/sequences/${sequence}`;
  const ackKey =
    `acks/ports/${port}/channels/${channelId}/sequences/${sequence}`;
  const receiptSiblings = tree.getSiblings(receiptKey);
  tree.set(receiptKey, "01");
  const ackSiblings = tree.getSiblings(ackKey);
  const ack = await sha256(fromText('{"result":"AQ=="}'));
  tree.set(ackKey, ack);
  const updates = [
    record(variant(1, packet, ack, proofHeight), [
      receiptSiblings,
      ackSiblings,
    ]),
  ];
  datum.fields[4] = (datum.fields[4] as bigint) + 1n;
  datum.fields[5] = await tree.getRoot();
  datum.fields[7] = [...(datum.fields[7] as bigint[]), sequence].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  const acks = datum.fields[8] as Map<bigint, string>;
  acks.set(sequence, ack);
  datum.fields[8] = new Map(
    [...acks].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  );
  const maximum = datum.fields[10] as Constr<Data>;
  const compareHeight = (a: Constr<Data>, b: Constr<Data>) =>
    a.fields[0] === b.fields[0]
      ? (a.fields[1] as bigint) > (b.fields[1] as bigint)
      : (a.fields[0] as bigint) > (b.fields[0] as bigint);
  if (compareHeight(proofHeight, maximum)) datum.fields[10] = proofHeight;
  const data = JSON.parse(toText(String(packet.fields[5])));
  const prefix = `${toText(String(packet.fields[1]))}/${
    toText(String(packet.fields[2]))
  }/`;

  addLaneBalance(
    datum,
    data.denom.startsWith(prefix)
      ? data.denom.slice(prefix.length)
      : `${port}/${channelId}/${data.denom}`,
    BigInt(data.amount) * (data.denom.startsWith(prefix) ? -1n : 1n),
  );
  const fields = record(
    ...[data.denom, data.amount, data.sender, data.receiver, data.memo ?? ""]
      .map(fromText),
  );
  const operation = variant(
    5,
    packet,
    fields,
    proofHeight,
    proof,
    record(outRef(input), updates),
    liquidity.map(outRef),
  );
  const mint: Record<string, bigint> = {
    [deployment.batchPolicy + fromText("receive")]: 1n,
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
  if (data.denom.startsWith(prefix)) {
    tx = await releaseLiquidity(
      lucid,
      deployment,
      tx,
      mint,
      port,
      channelId,
      sequence,
      data.denom.slice(prefix.length),
      BigInt(data.amount),
      data.receiver,
      liquidity,
    );
  } else {
    if (liquidity.length) {
      throw new Error("Voucher receive must not release escrow");
    }
    tx = voucherPayment(
      lucid,
      deployment,
      tx,
      port,
      channelId,
      sequence,
      `${port}/${channelId}/${data.denom}`,
      BigInt(data.amount),
      data.receiver,
    );
  }
  await requireUnspent(lucid, [
    input,
    deployment.channel,
    deployment.connection,
    deployment.client,
  ]);
  return {
    tx: await authorizeOperation(tx, deployment, operation, mint),
    input,
  };
}

export const buildPacketRejection = (
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  packet: Constr<Data>,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  liquidity: UTxO[],
  rejection: string,
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
    rejection,
  );

export function voucherTokenName(denom: string) {
  return "0014df10" +
    toHex(blake2b(new TextEncoder().encode(denom), { dkLen: 28 }));
}
export function localAssetUnit(
  denom: string,
  deployment: Pick<PacketLaneDeployment, "voucherPolicy">,
): string {
  if (denom === fromText("lovelace")) return "lovelace";
  if (/^[0-9a-f]{56,120}$/.test(denom) && denom.length % 2 === 0) return denom;
  if (!deployment.voucherPolicy) {
    throw new Error("Voucher policy is required for a traced denomination");
  }
  return deployment.voucherPolicy + voucherTokenName(denom);
}
function voucherPayment(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  tx: ReturnType<LucidEvolution["newTx"]>,
  port: string,
  channel: string,
  sequence: bigint,
  denom: string,
  amount: bigint,
  recipient: string,
) {
  const unit = localAssetUnit(denom, deployment);
  return tx.mintAssets({ [unit]: amount }, encode(variant(4))).pay
    .ToAddressWithData(
      credentialToAddress(lucid.config().network!, {
        type: "Key",
        hash: recipient,
      }),
      {
        kind: "inline",
        value: encode(record(fromText(port), fromText(channel), sequence)),
      },
      { [unit]: amount },
    );
}

export async function buildPacketPrune(
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  sequence: bigint,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  validFrom: number,
  validTo: number,
) {
  const { port, channelId } = channelIdentity(deployment);
  const lane = packetLane(port, channelId, sequence, deployment.laneCount);
  const input = await lucid.utxoByUnit(
    deployment.statePolicy +
      packetLaneTokenName(port, channelId, lane, deployment.laneCount),
  );
  const datum = copy(decode(input));
  const tree = await laneTree(datum);
  if (
    !(datum.fields[7] as bigint[]).includes(sequence) ||
    !(datum.fields[8] as Map<bigint, string>).has(sequence)
  ) throw new Error("Packet has no retained receipt and acknowledgement");
  const receiptKey =
    `receipts/ports/${port}/channels/${channelId}/sequences/${sequence}`;
  const ackKey =
    `acks/ports/${port}/channels/${channelId}/sequences/${sequence}`;
  const receiptSiblings = tree.getSiblings(receiptKey);
  tree.set(receiptKey, "");
  const ackSiblings = tree.getSiblings(ackKey);
  tree.set(ackKey, "");
  datum.fields[4] = (datum.fields[4] as bigint) + 1n;
  datum.fields[5] = await tree.getRoot();
  datum.fields[7] = (datum.fields[7] as bigint[]).filter((value) =>
    value !== sequence
  );
  (datum.fields[8] as Map<bigint, string>).delete(sequence);
  datum.fields[9] = proofHeight;
  const update = record(variant(3, sequence, proofHeight), [
    receiptSiblings,
    ackSiblings,
  ]);
  const operation = variant(
    7,
    sequence,
    proofHeight,
    proof,
    record(outRef(input), [update]),
  );
  await requireUnspent(lucid, [
    input,
    deployment.channel,
    deployment.connection,
    deployment.client,
  ]);
  const tx = lucid.newTx().readFrom([
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
  return {
    tx: await authorizeOperation(tx, deployment, operation, {
      [deployment.batchPolicy + fromText("prune")]: 1n,
    }),
    input,
  };
}

export const buildPacketTimeoutOnClose = (
  lucid: LucidEvolution,
  deployment: PacketLaneDeployment,
  packet: Constr<Data>,
  proofHeight: Constr<Data>,
  proof: Constr<Data>,
  proofClose: Constr<Data>,
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
    undefined,
    proofClose,
  );

/** Admission is permissionless, so batch discovery must reject unfunded or malformed datums. */
export function usableTransferIntent(
  input: UTxO,
  deployment: PacketLaneDeployment,
  validTo: number,
): boolean {
  try {
    const datum = decode(input);
    const { port, channelId } = channelIdentity(deployment);
    if (
      datum.index !== 0 || datum.fields.length !== 5 ||
      datum.fields[0] !== fromText(port) ||
      datum.fields[1] !== fromText(channelId) ||
      typeof datum.fields[2] !== "string" ||
      !/^[0-9a-f]{56}$/.test(datum.fields[2]) ||
      typeof datum.fields[4] !== "bigint" ||
      datum.fields[4] > 0xffffffffffffffffn ||
      datum.fields[4] <= BigInt(validTo) * 1_000_000n
    ) return false;
    const fields = datum.fields[3];
    if (
      !(fields instanceof Constr) || fields.index !== 0 ||
      fields.fields.length !== 5 || !fields.fields.every((v) =>
        typeof v === "string"
      )
    ) return false;
    const decoded = (fields.fields as string[]).map(toText);
    // Reject invalid UTF-8 rather than silently replacing bytes before the
    // on-chain comparison against the funded datum.
    if (
      decoded.some((value, index) => fromText(value) !== fields.fields[index])
    ) return false;
    const [denom, amount, sender, receiver, memo] = decoded;
    if (!/^[1-9][0-9]*$/.test(amount) || sender !== datum.fields[2]) {
      return false;
    }
    stringifyIcs20PacketData({ denom, amount, sender, receiver, memo });
    const unit = localAssetUnit(denom, deployment);
    if (
      unit !== "lovelace" && unit.startsWith(deployment.batchPolicy)
    ) return false;
    const value = BigInt(amount);
    return (input.assets[unit] ?? 0n) >= value &&
      (input.assets.lovelace ?? 0n) > (unit === "lovelace" ? value : 0n) &&
      Object.keys(input.assets).every((asset) =>
        asset === "lovelace" || asset === unit
      );
  } catch {
    return false;
  }
}

/** Script addresses accept arbitrary deposits. Authenticate before selecting funds. */
export function selectPacketLiquidity(
  inputs: UTxO[],
  deployment: PacketLaneDeployment,
  port: string,
  channel: string,
  denom: string,
  amount: bigint,
  sequence: bigint,
): UTxO[] {
  if (amount <= 0n || sequence < 1n) {
    throw new Error("Invalid liquidity request");
  }
  const candidates = inputs.flatMap((input) => {
    try {
      if (input.address !== deployment.batchAddress) return [];
      const datum = decode(input);
      const [p, c, d, policy, name, deposit, principal, owner] = datum.fields;
      if (
        datum.index !== 0 || datum.fields.length !== 8 ||
        p !== fromText(port) || c !== fromText(channel) ||
        d !== fromText(denom) ||
        typeof policy !== "string" || !/^([0-9a-f]{56})?$/.test(policy) ||
        typeof name !== "string" || !/^([0-9a-f]{2}){0,32}$/.test(name) ||
        (policy === "" && name !== "") || policy === deployment.batchPolicy ||
        !(deposit instanceof Constr) || deposit.index !== 0 ||
        deposit.fields.length !== 2 ||
        typeof deposit.fields[0] !== "string" ||
        !/^[0-9a-f]{64}$/.test(deposit.fields[0]) ||
        typeof deposit.fields[1] !== "bigint" || deposit.fields[1] < 0n ||
        deposit.fields[1] > 0xffffffffn ||
        typeof principal !== "bigint" || principal <= 0n ||
        !(owner instanceof Constr) || owner.index !== 0 ||
        owner.fields.length !== 2
      ) return [];
      // Issuance fixes the reserve owner to the intent's enterprise key address.
      const [credential, stake] = owner.fields;
      if (
        !(credential instanceof Constr) || credential.index !== 0 ||
        credential.fields.length !== 1 ||
        typeof credential.fields[0] !== "string" ||
        !/^[0-9a-f]{56}$/.test(credential.fields[0]) ||
        !(stake instanceof Constr) || stake.index !== 1 ||
        stake.fields.length !== 0
      ) return [];
      const unit = policy === "" ? "lovelace" : policy + name;
      if (unit !== localAssetUnit(denom, deployment)) return [];
      const identity = deployment.batchPolicy + liquidityTokenName(
        port,
        channel,
        denom,
        deposit.fields[0],
        Number(deposit.fields[1]),
      );
      if (
        input.assets[identity] !== 1n ||
        (unit !== "lovelace" && input.assets[unit] !== principal) ||
        (input.assets.lovelace ?? 0n) <=
          (unit === "lovelace" ? principal : 0n) ||
        Object.keys(input.assets).some((asset) =>
          asset !== "lovelace" && asset !== identity && asset !== unit
        )
      ) return [];
      return [{ input, principal }];
    } catch {
      // Decode and interpretation errors are local to this untrusted output.
      return [];
    }
  }).sort((a, b) =>
    a.input.txHash.localeCompare(b.input.txHash) ||
    a.input.outputIndex - b.input.outputIndex
  );
  const start = candidates.length
    ? Number((sequence - 1n) % BigInt(candidates.length))
    : 0;
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
  // Prefer an independent deposit that covers the payout. Rotation distributes
  // equal choices across packets without hiding a sufficient input.
  const sufficient = rotated.find(({ principal }) => principal >= amount);
  if (sufficient) return [sufficient.input];
  // The largest five principals cover every feasible bounded selection. Stable
  // sorting keeps the packet rotation as the tie breaker.
  rotated.sort((a, b) =>
    a.principal > b.principal ? -1 : a.principal < b.principal ? 1 : 0
  );
  const selected: UTxO[] = [];
  let total = 0n;
  for (const { input, principal } of rotated.slice(0, 5)) {
    selected.push(input);
    total += principal;
    if (total >= amount) break;
  }
  if (total < amount) {
    throw new Error(
      "Insufficient liquidity within the transaction input limit",
    );
  }
  return selected;
}
