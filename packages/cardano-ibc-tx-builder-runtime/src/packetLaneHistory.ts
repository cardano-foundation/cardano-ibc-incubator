import { Cbor, LazyCborArray } from "@harmoniclabs/cbor";
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";
import {
  CML,
  Constr,
  coreToUtxo,
  Data,
  fromHex,
  toHex,
  toText,
  type UTxO,
} from "@lucid-evolution/lucid";
import { ICS23MerkleTree } from "./ics23MerkleTree.ts";
import { packetLaneTokenName } from "@cardano-ibc/tx-builder/dist/packet-lanes";

export class PacketLaneTree {
  constructor(readonly tree = new ICS23MerkleTree()) {}
  set(key: string, value: string) {
    this.tree.set(key, value);
  }
  get(key: string) {
    return this.tree.get(key)?.toString("hex");
  }
  getRoot() {
    return this.tree.getRoot();
  }
  getSiblings(key: string) {
    return this.tree.getSiblings(key).map((value) => value.toString("hex"));
  }
  clone() {
    return new PacketLaneTree(this.tree.clone());
  }
}

function packetLaneDatum(output: UTxO): Constr<Data> {
  if (!output.datum) throw new Error("Packet lane requires an inline datum");
  const datum = Data.from(output.datum);
  if (
    !(datum instanceof Constr) || datum.index !== 0 ||
    datum.fields.length !== 12 ||
    !(datum.fields[6] instanceof Map) || !Array.isArray(datum.fields[7]) ||
    !(datum.fields[8] instanceof Map)
  ) throw new Error("Invalid packet lane datum");
  if (datum.fields[7].length || datum.fields[8].size) {
    throw new Error(
      "Legacy packet receipt lists require an explicit deployment migration",
    );
  }
  return datum;
}

export type PacketLaneHistoryTransaction = {
  txHash: string;
  inputs: { txHash: string; outputIndex: number }[];
  outputs: UTxO[];
  mint: Map<string, bigint>;
  redeemers: { type: string; index: number; data: string }[];
  mintPolicies: string[];
};

/** The source must also establish canonical block inclusion and phase-2 validity.
 * Hash original body bytes because CML can normalize inline datum encodings.
 */
export function decodePacketLaneHistoryTransaction(
  cbor: string,
  txHash: string,
): PacketLaneHistoryTransaction {
  const { parsed, offset } = Cbor.parseLazyWithOffset(cbor);
  if (
    !(parsed instanceof LazyCborArray) || parsed.array.length !== 4 ||
    offset !== cbor.length / 2 ||
    toHex(blake2b(parsed.array[0], { dkLen: 32 })) !== txHash
  ) throw new Error("Packet history transaction hash does not match CBOR");
  const tx = CML.Transaction.from_cbor_hex(cbor);
  if (!tx.is_valid()) {
    throw new Error("Packet history transaction is phase-2 invalid");
  }
  const body = tx.body();
  const inputs = [];
  for (let i = 0; i < body.inputs().len(); i++) {
    const input = body.inputs().get(i);
    inputs.push({
      txHash: input.transaction_id().to_hex(),
      outputIndex: Number(input.index()),
    });
  }
  const outputs = [];
  for (let i = 0; i < body.outputs().len(); i++) {
    outputs.push(coreToUtxo(CML.TransactionUnspentOutput.new(
      CML.TransactionInput.new(CML.TransactionHash.from_hex(txHash), BigInt(i)),
      body.outputs().get(i),
    )));
  }
  const mint = new Map<string, bigint>();
  const policies = body.mint()?.keys();
  const mintPolicies = [];
  for (let i = 0; policies && i < policies.len(); i++) {
    const policy = policies.get(i);
    mintPolicies.push(policy.to_hex());
    const assets = body.mint()!.get_assets(policy)!;
    const names = assets.keys();
    for (let j = 0; j < names.len(); j++) {
      const name = names.get(j);
      mint.set(policy.to_hex() + name.to_hex(), assets.get(name)!);
    }
  }
  const redeemers = [];
  const set = tx.witness_set().redeemers();
  const map = set?.as_map_redeemer_key_to_redeemer_val();
  const keys = map?.keys();
  for (let i = 0; map && keys && i < keys.len(); i++) {
    const key = keys.get(i);
    redeemers.push({
      type: key.tag() === CML.RedeemerTag.Mint ? "mint" : "other",
      index: Number(key.index()),
      data: map.get(key)!.data().to_cbor_hex(),
    });
  }
  const legacy = set?.as_arr_legacy_redeemer();
  for (let i = 0; legacy && i < legacy.len(); i++) {
    const item = legacy.get(i);
    redeemers.push({
      type: item.tag() === CML.RedeemerTag.Mint ? "mint" : "other",
      index: Number(item.index()),
      data: item.data().to_cbor_hex(),
    });
  }
  return {
    txHash,
    inputs,
    outputs,
    mint,
    mintPolicies: mintPolicies.sort(),
    redeemers,
  };
}

function constructor(value: Data, fields?: number): Constr<Data> {
  if (
    !(value instanceof Constr) ||
    (fields !== undefined && value.fields.length !== fields)
  ) {
    throw new Error("Invalid packet history redeemer");
  }
  return value;
}

function laneUpdates(operation: Constr<Data>): Constr<Data>[] {
  if (operation.index === 10) {
    return (operation.fields[0] as Constr<Data>[]).flatMap(laneUpdates);
  }
  if (operation.index === 0) return operation.fields[3] as Constr<Data>[];
  const field = operation.index === 1 || operation.index === 7
    ? 3
    : operation.index === 6
    ? 5
    : [2, 5, 8].includes(operation.index)
    ? 4
    : undefined;
  return field === undefined ? [] : [constructor(operation.fields[field], 2)];
}

function packetCommitment(packet: Constr<Data>): string {
  const height = constructor(packet.fields[6], 2);
  const integer = (value: Data) => {
    if (
      typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn
    ) {
      throw new Error("Invalid packet history integer");
    }
    return value.toString(16).padStart(16, "0");
  };
  return toHex(sha256(fromHex(
    integer(packet.fields[7]) + integer(height.fields[0]) +
      integer(height.fields[1]) +
      toHex(sha256(fromHex(String(packet.fields[5])))),
  )));
}

/** Rebuilt from canonical raw transactions, with every continuation root checked.
 * Instances are immutable to callers. A failed replay cannot poison a cached tree.
 */
export class PacketLaneHistory {
  private output?: UTxO;
  private tree = new PacketLaneTree();
  constructor(readonly unit: string, readonly batchPolicy: string) {}

  clone(): PacketLaneHistory {
    const next = new PacketLaneHistory(this.unit, this.batchPolicy);
    next.output = this.output;
    next.tree = this.tree.clone();
    return next;
  }

  current(): UTxO | undefined {
    return this.output;
  }

  at(target: UTxO): PacketLaneTree {
    if (
      !this.output || this.output.txHash !== target.txHash ||
      this.output.outputIndex !== target.outputIndex
    ) {
      throw new Error(
        "Packet history does not reach the requested lane output",
      );
    }
    const datum = packetLaneDatum(target);
    const current = packetLaneDatum(this.output);
    if (
      datum.fields.slice(0, 6).some((value, i) => value !== current.fields[i])
    ) {
      throw new Error(
        "Requested packet lane disagrees with its authenticated history",
      );
    }
    return this.tree.clone();
  }

  apply(tx: PacketLaneHistoryTransaction): void {
    const outputs = tx.outputs.filter((output) =>
      (output.assets[this.unit] ?? 0n) !== 0n
    );
    const spent = this.output &&
      tx.inputs.some((input) =>
        input.txHash === this.output!.txHash &&
        input.outputIndex === this.output!.outputIndex
      );
    if (!outputs.length) {
      if (spent) {
        throw new Error("Packet history is missing a lane continuation");
      }
      return;
    }
    if (outputs.length !== 1 || outputs[0].assets[this.unit] !== 1n) {
      throw new Error("Packet history has ambiguous lane identity");
    }
    const output = outputs[0];
    const datum = packetLaneDatum(output);
    const [port, channel, lane, count, version, root] = datum.fields;
    if (
      this.unit.slice(56) !==
        packetLaneTokenName(
          toText(String(port)),
          toText(String(channel)),
          Number(lane),
          Number(count),
        )
    ) throw new Error("Packet history lane identity does not match its NFT");
    const tree = this.tree.clone();
    if (!this.output) {
      if (
        version !== 0n || tx.mint.get(this.unit) !== 1n ||
        root !== "00".repeat(32) || (datum.fields[6] as Map<Data, Data>).size
      ) {
        throw new Error(
          "Packet history must start at empty authenticated lane issuance",
        );
      }
    } else {
      const old = packetLaneDatum(this.output);
      if (
        !spent || version !== (old.fields[4] as bigint) + 1n ||
        tx.mint.get(this.unit)
      ) {
        throw new Error("Packet history skips its live predecessor");
      }
      const index = tx.mintPolicies.indexOf(this.batchPolicy);
      const redeemers = tx.redeemers.filter((item) =>
        item.type === "mint" && item.index === index
      );
      if (index >= 0) {
        if (redeemers.length !== 1) {
          throw new Error("Packet history lacks its batch redeemer");
        }
        const authorization = constructor(Data.from(redeemers[0].data), 3);
        const updates = laneUpdates(constructor(authorization.fields[1]))
          .filter((update) => {
            const ref = constructor(constructor(update, 2).fields[0], 2);
            return ref.fields[0] === this.output!.txHash &&
              ref.fields[1] === BigInt(this.output!.outputIndex);
          });
        if (updates.length !== 1) {
          throw new Error("Packet history lacks its exact lane update");
        }
        for (const raw of updates[0].fields[1] as Data[]) {
          const mutation = constructor(constructor(raw, 2).fields[0]);
          const packet = mutation.index === 3
            ? undefined
            : constructor(mutation.fields[0], 8);
          const sequence = packet?.fields[0] ?? mutation.fields[0];
          const path = `/ports/${toText(String(port))}/channels/${
            toText(String(channel))
          }/sequences/${sequence}`;
          if (mutation.index === 0) {
            tree.set("commitments" + path, packetCommitment(packet!));
          } else if (mutation.index === 1) {
            if (tree.get("receipts" + path) || tree.get("acks" + path)) {
              throw new Error("Packet history repeats a receive");
            }
            tree.set("receipts" + path, "01");
            tree.set("acks" + path, String(mutation.fields[1]));
          } else if (mutation.index === 2) {
            if (tree.get("commitments" + path) !== packetCommitment(packet!)) {
              throw new Error("Packet history completes an absent commitment");
            }
            tree.set("commitments" + path, "");
          } else if (mutation.index === 3) {
            if (!tree.get("receipts" + path) || !tree.get("acks" + path)) {
              throw new Error("Packet history prunes absent state");
            }
            tree.set("receipts" + path, "");
            tree.set("acks" + path, "");
          } else throw new Error("Unknown packet history mutation");
        }
      }
      if (
        old.fields.slice(0, 4).some((value, i) => value !== datum.fields[i])
      ) {
        throw new Error("Packet history changes lane identity");
      }
    }
    if (tree.getRoot() !== root) {
      throw new Error(
        "Reconstructed packet history does not match the lane root",
      );
    }
    this.tree = tree;
    this.output = output;
  }
}
