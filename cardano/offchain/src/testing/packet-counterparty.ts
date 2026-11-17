import { type Constr, type Data, fromText } from "@lucid-evolution/lucid";
import { membershipProof } from "./channel-fixture.ts";
import { record, sha256 } from "../packet-lane-transactions.ts";

// A deterministic counterparty checkpoint. Every proof is checked by the
// deployed validators, but this fixture does not run a counterparty chain.
export async function packetCounterparty(entries: Array<[string, string]>) {
  const leaves = [];
  for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const membership = await membershipProof(fromText(key), value);
    const layers = membership.proof.fields[0] as Constr<Data>[];
    const existence = (layers[0].fields[0] as Constr<Data>).fields[0] as Constr<
      Data
    >;
    const outer = (layers[1].fields[0] as Constr<Data>).fields[0] as Constr<
      Data
    >;
    leaves.push({
      key,
      proof: membership.proof,
      existence,
      outer,
      hash: outer.fields[1] as string,
    });
  }
  if (leaves.length !== 16) {
    throw new Error("Packet checkpoint requires sixteen leaves");
  }
  let nodes = leaves.map((leaf) => ({ hash: leaf.hash, leaves: [leaf] }));
  for (let level = 1; nodes.length > 1; level++) {
    const next = [];
    const prefix = (level * 2).toString(16).padStart(2, "0") +
      (2 ** (level + 1)).toString(16).padStart(2, "0") + "02";
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i], right = nodes[i + 1];
      for (const leaf of left.leaves) {
        (leaf.existence.fields[3] as Data[]).push(
          record(1n, prefix + "20", "20" + right.hash),
        );
      }
      for (const leaf of right.leaves) {
        (leaf.existence.fields[3] as Data[]).push(
          record(1n, prefix + "20" + left.hash + "20", ""),
        );
      }
      next.push({
        hash: await sha256(prefix + "20" + left.hash + "20" + right.hash),
        leaves: [...left.leaves, ...right.leaves],
      });
    }
    nodes = next;
  }
  const innerRoot = nodes[0].hash;
  for (const leaf of leaves) leaf.outer.fields[1] = innerRoot;
  return {
    root: await sha256(
      "0003" + fromText("ibc") + "20" + await sha256(innerRoot),
    ),
    proofs: Object.fromEntries(leaves.map((leaf) => [leaf.key, leaf.proof])),
  };
}
