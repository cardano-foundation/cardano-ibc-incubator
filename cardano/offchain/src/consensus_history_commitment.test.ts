import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { Constr, Data } from "@lucid-evolution/lucid";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  ConsensusHistoryCommitment,
  consensusHistoryKey,
  decodeConsensusHistoryRecord,
  EMPTY_CONSENSUS_HISTORY_ROOT,
  encodeConsensusHistoryRecord,
  recordFromConstr,
  recordToConstr,
} from "./consensus_history_commitment.ts";

function record(height = 1n) {
  return {
    clientToken: { policyId: "11".repeat(28), name: "22" },
    height: { revisionNumber: 0n, revisionHeight: height },
    consensusState: { timestamp: 7n, nextValidatorsHash: "cc", root: "dd" },
    processedTime: 8n,
    processedHeight: 9n,
  };
}

// Shared verbatim with the Aiken consensus-history commitment test vector.
const VECTOR_KEY = "internal/consensus-history/v1/" +
  "d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffff";
const VECTOR_VALUE =
  "d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffd8799f0741ccd8799f41ddffff0809ff";
const VECTOR_ROOT =
  "caee7ebf5c9bd19dc904e771797ce4e98f91301273dd86c9f32dc8c8a4fc6e7f";

// Independent, single-path verifier: unlike DeploymentIbcTree it never builds
// a tree. This checks witness ordering and that all encoded fields are bound.
function rootFromWitness(
  key: string,
  value: string,
  siblings: string[],
): string {
  assertEquals(siblings.length, 64);
  const hash = (...parts: Uint8Array[]) =>
    createHash("sha256").update(Buffer.concat(parts)).digest();
  const zero = Buffer.alloc(32);
  const keyHash = hash(Buffer.from(key, "utf8"));
  let index = keyHash.readBigUInt64BE();
  let current = value === ""
    ? zero
    : hash(Buffer.from([0]), keyHash, hash(Buffer.from(value, "hex")));
  for (const encoded of siblings) {
    const sibling = Buffer.from(encoded, "hex");
    assertEquals(sibling.length, 32);
    const [left, right] = index & 1n ? [sibling, current] : [current, sibling];
    current = left.equals(zero) && right.equals(zero)
      ? zero
      : hash(Buffer.from([1]), left, right);
    index >>= 1n;
  }
  return current.toString("hex");
}

Deno.test("consensus history normalizes nested constructors and round-trips", () => {
  const original = record();
  assertEquals(recordFromConstr(recordToConstr(original)), original);
  assertEquals(
    decodeConsensusHistoryRecord(encodeConsensusHistoryRecord(original)),
    original,
  );
  const definite = Data.to<Data>(recordToConstr(original), undefined, {
    canonical: true,
  });
  assertNotEquals(definite, VECTOR_VALUE);
  assertEquals(
    encodeConsensusHistoryRecord(decodeConsensusHistoryRecord(definite)),
    VECTOR_VALUE,
  );
  const upperCase = {
    ...original,
    consensusState: { ...original.consensusState, root: "DD" },
  };
  assertEquals(encodeConsensusHistoryRecord(upperCase), VECTOR_VALUE);
});

Deno.test("consensus history rejects malformed records", () => {
  assertThrows(
    () => recordFromConstr(new Constr(1, [])),
    Error,
    "constructor 0",
  );
  assertThrows(
    () => encodeConsensusHistoryRecord({ ...record(), processedTime: -1n }),
    Error,
    "nonnegative bigint",
  );
  assertThrows(
    () =>
      encodeConsensusHistoryRecord({
        ...record(),
        clientToken: { policyId: "zz", name: "22" },
      }),
    Error,
    "byte hex",
  );
  assertThrows(() => decodeConsensusHistoryRecord("d8799f"));
});

Deno.test("consensus history agrees with the fixed Aiken key/value/root vector", async () => {
  const original = record();
  const tree = new ConsensusHistoryCommitment();
  assertEquals(
    consensusHistoryKey(original.clientToken, original.height),
    VECTOR_KEY,
  );
  assertEquals(encodeConsensusHistoryRecord(original), VECTOR_VALUE);
  const insertion = await tree.insertionWitness(original);
  assertEquals(insertion.root, EMPTY_CONSENSUS_HISTORY_ROOT);
  assertEquals(
    insertion.siblings,
    Array(64).fill(EMPTY_CONSENSUS_HISTORY_ROOT),
  );
  assertEquals(
    rootFromWitness(insertion.key, "", insertion.siblings),
    insertion.root,
  );
  assertEquals(
    rootFromWitness(insertion.key, insertion.value, insertion.siblings),
    VECTOR_ROOT,
  );
  assertEquals(tree.size, 0);
  tree.append(original);
  const witness = await tree.witness(original.clientToken, original.height);
  assertEquals(witness.root, VECTOR_ROOT);
  assertEquals(
    rootFromWitness(witness.key, witness.value, witness.siblings),
    VECTOR_ROOT,
  );
});

Deno.test("history witnesses bind client, both height components and processing metadata", async () => {
  const original = record();
  const tree = new ConsensusHistoryCommitment();
  tree.append(original);
  tree.append(record(2n));
  const proof = await tree.witness(original.clientToken, original.height);
  assertEquals(
    rootFromWitness(proof.key, proof.value, proof.siblings),
    await tree.getRoot(),
  );
  const variants = [
    {
      ...original,
      clientToken: { ...original.clientToken, policyId: "33".repeat(28) },
    },
    { ...original, clientToken: { ...original.clientToken, name: "33" } },
    { ...original, height: { ...original.height, revisionNumber: 1n } },
    { ...original, height: { ...original.height, revisionHeight: 3n } },
    { ...original, processedTime: 10n },
    { ...original, processedHeight: 10n },
    {
      ...original,
      consensusState: { ...original.consensusState, timestamp: 10n },
    },
    { ...original, consensusState: { ...original.consensusState, root: "ee" } },
    {
      ...original,
      consensusState: { ...original.consensusState, nextValidatorsHash: "ee" },
    },
  ];
  for (const altered of variants) {
    assertNotEquals(
      rootFromWitness(
        consensusHistoryKey(altered.clientToken, altered.height),
        encodeConsensusHistoryRecord(altered),
        proof.siblings,
      ),
      proof.root,
    );
  }
  await assertRejects(
    () => tree.witness(original.clientToken, record(99n).height),
    Error,
    "not found",
  );
});

Deno.test("history records are immutable and existing keys cannot be overwritten", async () => {
  const input = record();
  const tree = new ConsensusHistoryCommitment();
  tree.append(input);
  input.consensusState.root = "ee";
  input.clientToken.name = "33";
  assertEquals(await tree.getRoot(), VECTOR_ROOT);
  assertThrows(() => tree.append(record()), Error, "already exists");
  assertThrows(
    () => tree.append({ ...record(), processedTime: 100n }),
    Error,
    "already exists",
  );
  await assertRejects(
    () => tree.insertionWitness(record()),
    Error,
    "already exists",
  );
  const original = record();
  const returned = tree.get(original.clientToken, original.height)!;
  Object.assign(returned.consensusState, { root: "ee" });
  const proof = await tree.witness(original.clientToken, original.height);
  proof.siblings[0] = "ff".repeat(32);
  Object.assign(proof.record, { processedTime: 100n });
  const snapshot = await tree.snapshot();
  snapshot.records[0] = "bad";
  assertEquals(tree.get(original.clientToken, original.height), original);
  assertEquals(
    (await tree.witness(original.clientToken, original.height)).siblings[0],
    EMPTY_CONSENSUS_HISTORY_ROOT,
  );
  assertEquals((await tree.snapshot()).records, [VECTOR_VALUE]);
  assertEquals(await tree.getRoot(), VECTOR_ROOT);
});

Deno.test("snapshot and replay require an independent root and reject missing/corrupt history", async () => {
  const records = [record(), record(2n), record(3n)];
  const tree = new ConsensusHistoryCommitment();
  records.forEach((item) => tree.append(item));
  const expectedRoot = await tree.getRoot();
  const snapshot = await tree.snapshot();
  const restored = await ConsensusHistoryCommitment.fromSnapshot(
    snapshot,
    expectedRoot,
  );
  assertEquals(restored.size, 3);
  assertEquals(await restored.getRoot(), expectedRoot);
  assertEquals(
    await (await ConsensusHistoryCommitment.replay(
      [...records].reverse(),
      expectedRoot,
    )).getRoot(),
    expectedRoot,
  );
  await assertRejects(
    () =>
      ConsensusHistoryCommitment.fromSnapshot({
        ...snapshot,
        records: snapshot.records.slice(1),
      }, expectedRoot),
    Error,
    "replayed history",
  );
  const corrupt = [
    encodeConsensusHistoryRecord({ ...records[0], processedTime: 99n }),
    ...snapshot.records.slice(1),
  ];
  await assertRejects(
    () =>
      ConsensusHistoryCommitment.fromSnapshot(
        { ...snapshot, records: corrupt },
        expectedRoot,
      ),
    Error,
    "replayed history",
  );
  await assertRejects(
    () =>
      ConsensusHistoryCommitment.fromSnapshot({
        ...snapshot,
        root: EMPTY_CONSENSUS_HISTORY_ROOT,
      }, expectedRoot),
    Error,
    "snapshot root",
  );
  await assertRejects(
    () =>
      ConsensusHistoryCommitment.fromSnapshot(
        snapshot,
        undefined as unknown as string,
      ),
    Error,
    "independently expected root",
  );
  await assertRejects(
    () =>
      ConsensusHistoryCommitment.fromSnapshot({
        version: 1,
        root: expectedRoot,
      }, expectedRoot),
    Error,
    "version or records",
  );
  await assertRejects(
    () =>
      ConsensusHistoryCommitment.fromSnapshot(
        { ...snapshot, records: ["zz"] },
        expectedRoot,
      ),
    Error,
    "byte hex",
  );
  await assertRejects(
    () => ConsensusHistoryCommitment.replay([record(), record()], expectedRoot),
    Error,
    "already exists",
  );
});

Deno.test("async witnesses and snapshots remain coherent across a concurrent append", async () => {
  const tree = new ConsensusHistoryCommitment();
  const original = record();
  tree.append(original);
  const pendingProof = tree.witness(original.clientToken, original.height);
  const pendingSnapshot = tree.snapshot();
  tree.append(record(2n));
  assertEquals((await pendingProof).root, VECTOR_ROOT);
  assertEquals(await pendingSnapshot, {
    version: 1,
    root: VECTOR_ROOT,
    records: [VECTOR_VALUE],
  });
  assertNotEquals(await tree.getRoot(), VECTOR_ROOT);
  assertEquals((await tree.snapshot()).records.length, 2);
});
