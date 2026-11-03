import { assert, assertEquals, assertRejects } from "@std/assert";
import { CML } from "@lucid-evolution/lucid";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { type CacheLeaf, cacheRecord } from "../src/tendermint-cache.ts";
import {
  cachedUpdateFixture,
  retainedScenario,
} from "./tendermint-cache-fixture.ts";

// Independent protobuf encoding for synthetic CometBFT headers and precommits.
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
function varint(value: bigint): Buffer {
  const result: number[] = [];
  do {
    result.push(Number(value & 127n) | (value > 127n ? 128 : 0));
    value >>= 7n;
  } while (value);
  return Buffer.from(result);
}
const bytes = (field: number, value: Buffer) =>
  value.length
    ? Buffer.concat([
      varint(BigInt(field * 8 + 2)),
      varint(BigInt(value.length)),
      value,
    ])
    : Buffer.alloc(0);
const integer = (field: number, value: bigint) =>
  value
    ? Buffer.concat([varint(BigInt(field * 8)), varint(value)])
    : Buffer.alloc(0);
function fixed(field: number, value: bigint) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigInt64LE(value);
  return value
    ? Buffer.concat([varint(BigInt(field * 8 + 1)), encoded])
    : Buffer.alloc(0);
}
const timestamp = (value: string) =>
  Buffer.concat([
    integer(1, BigInt(value) / 1_000_000_000n),
    integer(2, BigInt(value) % 1_000_000_000n),
  ]);
function block(
  value: typeof retainedScenario.header.signed_header.commit.block_id,
) {
  return Buffer.concat([
    bytes(1, Buffer.from(value.hash, "hex")),
    bytes(
      2,
      Buffer.concat([
        integer(1, BigInt(value.part_set_header.total)),
        bytes(2, Buffer.from(value.part_set_header.hash, "hex")),
      ]),
    ),
  ]);
}
function merkle(values: Buffer[]): Buffer {
  if (values.length === 1) {
    return hash(Buffer.concat([Buffer.from([0]), values[0]]));
  }
  let pivot = 1;
  while (pivot * 2 < values.length) pivot *= 2;
  return hash(
    Buffer.concat([
      Buffer.from([1]),
      merkle(values.slice(0, pivot)),
      merkle(values.slice(pivot)),
    ]),
  );
}

function dualQuorumScenario(weighted = false) {
  const scenario = structuredClone(retainedScenario);
  const keys = Array.from(
    { length: 65 },
    (_, index) =>
      CML.PrivateKey.from_normal_bytes(
        hash(Buffer.from(`dual-quorum-${index}`)),
      ),
  );
  const validators = keys.map((key) => ({
    address: hash(key.to_public().to_raw_bytes()).toString("hex").slice(0, 40),
    pub_key: {
      ed25519: Buffer.from(key.to_public().to_raw_bytes()).toString("hex"),
    },
    voting_power: "1",
    proposer_priority: "0",
  })).sort((a, b) => a.address.localeCompare(b.address));
  if (weighted) {
    for (const validator of validators.slice(0, 17)) {
      validator.voting_power = "10";
    }
  }
  const target: CacheLeaf[] = validators.map((validator, index) => ({
    index,
    pubkey: validator.pub_key.ed25519,
    power: BigInt(validator.voting_power),
  }));
  const trusted = target.map((leaf, index) => ({
    ...leaf,
    power: index === 64 ? 100n : 1n,
  }))
    .sort((a, b) =>
      a.power === b.power ? a.index - b.index : a.power > b.power ? -1 : 1
    )
    .map((leaf, index) => ({ ...leaf, index }));
  scenario.header.validator_set = {
    validators,
    proposer: validators[0],
    total_voting_power: cacheRecord(target).totalPower.toString(),
  };
  scenario.header.trusted_validators = {
    validators: trusted.map((leaf) => ({
      address: hash(Buffer.from(leaf.pubkey, "hex")).toString("hex").slice(
        0,
        40,
      ),
      pub_key: { ed25519: leaf.pubkey },
      voting_power: leaf.power.toString(),
      proposer_priority: "0",
    })),
    proposer: validators[64],
    total_voting_power: "164",
  };
  const h = scenario.header.signed_header.header;
  h.validators_hash = cacheRecord(target).root;
  h.next_validators_hash = h.validators_hash;
  h.proposer_address = validators[0].address;
  const encoded = [
    Buffer.concat([
      integer(1, BigInt(h.version.block)),
      integer(2, BigInt(h.version.app)),
    ]),
    bytes(1, Buffer.from(h.chain_id)),
    integer(1, BigInt(h.height)),
    timestamp(h.time),
    block(h.last_block_id),
    ...[
      h.last_commit_hash,
      h.data_hash,
      h.validators_hash,
      h.next_validators_hash,
      h.consensus_hash,
      h.app_hash,
      h.last_results_hash,
      h.evidence_hash,
      h.proposer_address,
    ].map((value) => bytes(1, Buffer.from(value, "hex"))),
  ];
  const commit = scenario.header.signed_header.commit;
  commit.block_id.hash = merkle(encoded).toString("hex");
  const vote = Buffer.concat([
    integer(1, 2n),
    fixed(2, BigInt(commit.height)),
    fixed(3, BigInt(commit.round)),
    bytes(4, block(commit.block_id)),
    bytes(5, timestamp(h.time)),
    bytes(6, Buffer.from(h.chain_id)),
  ]);
  const signBytes = Buffer.concat([varint(BigInt(vote.length)), vote]);
  const keyByPublic = new Map(
    keys.map((
      key,
    ) => [Buffer.from(key.to_public().to_raw_bytes()).toString("hex"), key]),
  );
  commit.signatures = validators.map((validator) => ({
    block_id_flag: 2,
    validator_address: validator.address,
    timestamp: h.time,
    signature: keyByPublic.get(validator.pub_key.ed25519)!.sign(signBytes)
      .to_hex(),
  }));
  return { scenario, trusted };
}

Deno.test("one trusted membership brings the 44-signature update within the direct budget", async () => {
  const { scenario, trusted } = dualQuorumScenario();
  const options = {
    scenario,
    trustedLeaves: trusted,
    generalChange: "unchanged" as const,
    productionWitness: true,
    existingCache: true,
    cacheTarget: true,
  };
  const before = await cachedUpdateFixture("full", "none", {
    ...options,
    allTrustedOverlaps: true,
  });
  const result = await cachedUpdateFixture("full", "none", options);
  console.log(
    JSON.stringify({
      before: {
        path: before.path,
        witness: before.directWitness,
        directBudget: before.directBudget,
        completeFee: before.completeFee,
        updateTransactions: before.updateTransactions,
      },
      after: {
        path: result.path,
        witness: result.directWitness,
        measured: result.measured,
        directBudget: result.directBudget,
        completeFee: result.completeFee,
        updateTransactions: result.updateTransactions,
      },
    }),
  );
  assertEquals(result.signatures, 44);
  assertEquals(before.directWitness?.signatures, 44);
  assertEquals(before.directWitness?.target, 44);
  assertEquals(before.directWitness?.trusted, 44);
  assertEquals(result.directWitness?.signatures, 44);
  assertEquals(result.directWitness?.target, 44);
  assertEquals(result.directWitness?.trusted, 1);
  assert(before.directBudget);
  assert(
    result.directBudget,
    "The direct candidate must reach complete transaction evaluation",
  );
  assert(
    result.directBudget.measured.signedBytes <
      before.directBudget.measured.signedBytes,
  );
  assert(
    result.directBudget.measured.memory < before.directBudget.measured.memory,
  );
  assert(
    result.directBudget.measured.steps < before.directBudget.measured.steps,
  );
  assertEquals(before.path, "staged");
  assertEquals(result.path, "direct");
  assert(result.directBudget.fits);
  assertEquals(result.directBudget.headroomPercent, 5);
  assertEquals(result.updateTransactions, 1);
  assert(result.completeFee < before.completeFee);
});

for (
  const mutation of [
    "cached-trusted-power",
    "cached-trusted-overlap",
    "cached-trusted-unsigned",
  ] as const
) {
  Deno.test(`the minimized trusted proof rejects ${mutation}`, async () => {
    const { scenario, trusted } = dualQuorumScenario();
    await assertRejects(
      () =>
        cachedUpdateFixture("full", mutation, {
          scenario,
          trustedLeaves: trusted,
          generalChange: "unchanged",
          productionWitness: true,
          existingCache: true,
          cacheTarget: true,
        }),
      Error,
      "cached update:",
    );
  });
}

Deno.test("a weighted target replaces the 55-signature prefix with a complete direct update", async () => {
  const { scenario, trusted } = dualQuorumScenario(true);
  const result = await cachedUpdateFixture("full", "none", {
    scenario,
    trustedLeaves: trusted,
    generalChange: "unchanged",
    productionWitness: true,
    existingCache: true,
    cacheTarget: true,
  });
  console.log(
    JSON.stringify({
      path: result.path,
      signatures: result.signatures,
      measured: result.measured,
      directBudget: result.directBudget,
    }),
  );
  assertEquals(result.signatures, 16);
  assertEquals(result.path, "direct");
  assert(result.directBudget?.fits);
  assertEquals(result.updateTransactions, 1);
});
