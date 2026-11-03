import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { type Constr, credentialToAddress, Data } from "@lucid-evolution/lucid";
import {
  type CachedHeader,
  type CacheLeaf,
  cacheLeafData,
  cacheLeafHash,
  cacheRecord,
  decodeCachedUpdate,
  DirectUpdateUnsupported,
  prepareCachedHeader,
  validatorMultiproof,
} from "./tendermintCache.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const address = (pubkey: string) =>
  createHash("sha256").update(Buffer.from(pubkey, "hex")).digest("hex").slice(
    0,
    40,
  );
const canonical = (leaves: CacheLeaf[]) =>
  [...leaves].sort((a, b) =>
    a.power === b.power
      ? address(a.pubkey).localeCompare(address(b.pubkey))
      : a.power > b.power
      ? -1
      : 1
  ).map((leaf, index) => ({ ...leaf, index }));

function scenario(count: number, trustedPowers?: bigint[], cached = true) {
  const target = canonical(
    Array.from(
      { length: count },
      (_, index) => ({
        index,
        pubkey: digest(`validator-${index}`),
        power: 1n,
      }),
    ),
  );
  const trusted = canonical(
    target.map((leaf, index) => ({
      ...leaf,
      power: trustedPowers?.[index] ?? 1n,
    })),
  );
  const targetRecord = cacheRecord(target), oldRecord = cacheRecord(trusted);
  const blockId = {
    hash: "ab".repeat(32),
    partSetHeader: { total: 1n, hash: "cd".repeat(32) },
  };
  const trustedHeight = { revisionNumber: 1n, revisionHeight: 10n };
  const header: CachedHeader = {
    signedHeader: {
      header: {
        version: { block: 11n, app: 0n },
        chainId: "746573742d31",
        height: 12n,
        time: 1n,
        lastBlockId: blockId,
        lastCommitHash: "",
        dataHash: "",
        validatorsHash: targetRecord.root,
        nextValidatorsHash: targetRecord.root,
        consensusHash: "",
        appHash: "",
        lastResultsHash: "",
        evidenceHash: "",
        proposerAddress: address(target[0].pubkey),
      },
      commit: {
        height: 12n,
        round: 0n,
        blockId,
        signatures: target.map((leaf) => ({
          block_id_flag: 2n,
          validator_address: address(leaf.pubkey),
          timestamp: 1n,
          signature: "ab".repeat(64),
        })),
      },
    },
    trustedHeight,
    validatorSet: {
      validators: target.map((leaf) => ({
        pubkey: leaf.pubkey,
        address: address(leaf.pubkey),
        votingPower: leaf.power,
      })),
    },
    trustedValidators: {
      validators: trusted.map((leaf) => ({
        pubkey: leaf.pubkey,
        address: address(leaf.pubkey),
        votingPower: leaf.power,
      })),
    },
  };
  const args: Parameters<typeof prepareCachedHeader>[0] = {
    header,
    trustedRoot: oldRecord.root,
    latestHeight: trustedHeight,
    trustLevel: { numerator: 1n, denominator: 3n },
    historySiblings: Array(64).fill("00".repeat(32)),
    cache: {
      token: { policyId: "11".repeat(28), name: "01" },
      clientToken: { policyId: "22".repeat(28), name: "02" },
      clientAddress: credentialToAddress("Preprod", {
        type: "Script",
        hash: "33".repeat(28),
      }),
      records: cached
        ? oldRecord.root === targetRecord.root
          ? [oldRecord]
          : [oldRecord, targetRecord]
        : [],
    },
  };
  return { args, target, trusted };
}

function cachedProofs(redeemer: string) {
  const update = (Data.from(redeemer) as Constr<Data>)
    .fields[0] as Constr<Data>;
  const leaves = (field: number): CacheLeaf[] =>
    (update.fields[field] as Constr<Data>[]).map((leaf) => ({
      index: Number(leaf.fields[0]),
      pubkey: leaf.fields[1] as string,
      power: leaf.fields[2] as bigint,
    }));
  return {
    target: leaves(3),
    trusted: leaves(5),
    targetSiblings: update.fields[4] as string[],
    trustedSiblings: update.fields[6] as string[],
    sets: update.fields[7] as Data[],
  };
}

function proofRoot(count: number, leaves: CacheLeaf[], siblings: string[]) {
  let consumed = 0;
  const walk = (start: number, count: number): string => {
    const covered = leaves.filter((leaf) =>
      leaf.index >= start && leaf.index < start + count
    );
    if (!covered.length) return siblings[consumed++];
    if (count === 1) return cacheLeafHash(covered[0]);
    const pivot = 2 ** Math.floor(Math.log2(count - 1));
    return createHash("sha256").update(Buffer.from(
      "01" + walk(start, pivot) + walk(start + pivot, count - pivot),
      "hex",
    )).digest("hex");
  };
  const root = walk(0, count);
  assert.equal(consumed, siblings.length);
  return root;
}

function allOverlapRedeemer(redeemer: string, trusted: CacheLeaf[]) {
  const raw = Data.from(redeemer) as Constr<Data>;
  const update = raw.fields[0] as Constr<Data>;
  const signedKeys = new Set(
    cachedProofs(redeemer).target.map((leaf) => leaf.pubkey),
  );
  const overlaps = trusted.filter((leaf) => signedKeys.has(leaf.pubkey));
  update.fields[5] = overlaps.map(cacheLeafData);
  update.fields[6] = validatorMultiproof(
    trusted,
    overlaps.map((leaf) => leaf.index),
  );
  return Data.to<Data>(raw, undefined, { canonical: true });
}

function checkSelection(
  args: Parameters<typeof prepareCachedHeader>[0],
  target: CacheLeaf[],
  trusted: CacheLeaf[],
) {
  const prepared = prepareCachedHeader(args);
  const witness = decodeCachedUpdate(prepared.redeemer)!;
  const indices = witness.signers;
  assert.deepEqual(indices, [...new Set(indices)].sort((a, b) => a - b));
  assert.equal(indices.length, prepared.signatureCount);
  assert(indices.length <= 45);
  const oldByKey = new Map(trusted.map((leaf) => [leaf.pubkey, leaf.power]));
  const selected = indices.map((index) => target[index]);
  assert(
    selected.reduce((sum, leaf) => sum + leaf.power, 0n) * 3n >
      cacheRecord(target).totalPower * 2n,
  );
  assert(
    selected.reduce(
          (sum, leaf) => sum + (oldByKey.get(leaf.pubkey) ?? 0n),
          0n,
        ) * args.trustLevel.denominator >
      cacheRecord(trusted).totalPower * args.trustLevel.numerator,
  );
  assert(
    indices.every((index) =>
      args.header.signedHeader.commit.signatures[index].block_id_flag === 2n
    ),
  );
  assert.deepEqual(
    witness.signedHeader.commit.signatures.map((sig) => sig.validator_address),
    indices.map((index) => address(target[index].pubkey)),
  );
  const proofs = cachedProofs(prepared.redeemer);
  if (!proofs.sets.length) {
    assert.deepEqual(proofs.target, selected);
    assert.equal(
      proofRoot(target.length, proofs.target, proofs.targetSiblings),
      cacheRecord(target).root,
    );
    if (cacheRecord(target).root === args.trustedRoot) {
      assert.deepEqual(proofs.trusted, []);
      assert.deepEqual(proofs.trustedSiblings, []);
    } else {
      const positions = proofs.trusted.map((leaf) => leaf.index);
      assert.deepEqual(
        positions,
        [...new Set(positions)].sort((a, b) => a - b),
      );
      assert.deepEqual(
        proofs.trusted,
        positions.map((index) => trusted[index]),
      );
      assert(
        proofs.trusted.every((leaf) =>
          selected.some((signer) => signer.pubkey === leaf.pubkey)
        ),
      );
      assert(
        proofs.trusted.reduce((sum, leaf) => sum + leaf.power, 0n) *
            args.trustLevel.denominator >
          cacheRecord(trusted).totalPower * args.trustLevel.numerator,
      );
      assert.equal(
        proofRoot(trusted.length, proofs.trusted, proofs.trustedSiblings),
        args.trustedRoot,
      );
    }
  } else {
    assert.deepEqual(proofs.trusted, []);
    assert.deepEqual(proofs.trustedSiblings, []);
  }
  return prepared;
}

test("the 65-validator dual-quorum counterexample needs 44 available signatures instead of a 55-signature prefix", () => {
  for (const cached of [true, false]) {
    const { args, target, trusted } = scenario(65, [
      ...Array<bigint>(64).fill(1n),
      100n,
    ], cached);
    assert.equal(trusted.reduce((sum, leaf) => sum + leaf.power, 0n), 164n);
    const result = checkSelection(args, target, trusted);
    assert.equal(result.signatureCount, 44);
    if (cached) {
      assert.deepEqual(cachedProofs(result.redeemer).trusted, [trusted[0]]);
      assert.equal(trusted[0].power, 100n);
      assert(
        result.redeemer.length <
          allOverlapRedeemer(result.redeemer, trusted).length,
      );
    }
    const selected = decodeCachedUpdate(result.redeemer)!.signers;
    assert(selected.includes(64));
    assert.equal(
      selected.reduce((sum, index) => sum + (index === 64 ? 100n : 1n), 0n),
      143n,
    );
    assert(result.candidateCount >= 1 && result.candidateCount <= 3);
    for (
      let signerCandidate = 0;
      signerCandidate < result.candidateCount;
      signerCandidate++
    ) {
      checkSelection({ ...args, signerCandidate }, target, trusted);
    }
    assert.deepEqual(prepareCachedHeader(args), result);
  }
});

test("trusted membership selection uses the strict configured threshold independently of target signatures", () => {
  for (
    const [numerator, denominator, count] of [[1n, 3n, 2], [1n, 2n, 3]] as const
  ) {
    const { args, target, trusted } = scenario(7, [1n, 1n, 1n, 1n, 2n, 2n, 4n]);
    args.trustLevel = { numerator, denominator };
    args.header.signedHeader.commit.signatures[0].block_id_flag = 1n;
    args.header.signedHeader.commit.signatures[1].block_id_flag = 1n;
    const result = checkSelection(args, target, trusted);
    assert.equal(result.signatureCount, 5);
    const proof = cachedProofs(result.redeemer);
    assert.equal(proof.trusted.length, count);
    assert(
      proof.trusted.slice(0, -1).reduce((sum, leaf) => sum + leaf.power, 0n) *
          denominator <= cacheRecord(trusted).totalPower * numerator,
    );
  }
});

test("separate trusted proofs require both different roots to be cached", () => {
  for (const cachedRoot of ["target", "trusted"] as const) {
    const { args, target, trusted } = scenario(12, [
      ...Array<bigint>(11).fill(1n),
      100n,
    ]);
    args.cache.records = [
      cacheRecord(cachedRoot === "target" ? target : trusted),
    ];
    const result = checkSelection(args, target, trusted);
    assert.equal(cachedProofs(result.redeemer).sets.length, 1);
  }
});

test("all overlapping memberships are retained when the configured threshold needs them", () => {
  const { args, target, trusted } = scenario(6, [1n, 1n, 1n, 1n, 1n, 2n]);
  args.trustLevel = { numerator: 9n, denominator: 10n };
  const result = checkSelection(args, target, trusted);
  assert.equal(result.signatureCount, 6);
  assert.equal(cachedProofs(result.redeemer).trusted.length, 6);
  assert.equal(result.redeemer, allOverlapRedeemer(result.redeemer, trusted));
});

test("an unavailable trusted high-power signer cannot be used to avoid the direct limit", () => {
  const { args } = scenario(65, [...Array<bigint>(64).fill(1n), 100n]);
  args.header.signedHeader.commit.signatures[64].block_id_flag = 1n;
  assert.throws(() => prepareCachedHeader(args), DirectUpdateUnsupported);
});

test("the target signature limit and strict two-thirds boundary are preserved", () => {
  const { args, target, trusted } = scenario(66, [
    ...Array<bigint>(65).fill(1n),
    100n,
  ]);
  assert.equal(checkSelection(args, target, trusted).signatureCount, 45);
  assert.throws(
    () => prepareCachedHeader(scenario(70).args),
    DirectUpdateUnsupported,
  );
});

test("an exact one-third trusted overlap does not qualify", () => {
  const { args, target, trusted } = scenario(7, [2n, 2n, 2n, 2n, 2n, 10n, 10n]);
  args.header.signedHeader.commit.signatures[5].block_id_flag = 1n;
  args.header.signedHeader.commit.signatures[6].block_id_flag = 1n;
  assert.throws(
    () => prepareCachedHeader(args),
    /Available signatures do not satisfy both quorum rules/,
  );
  args.header.signedHeader.commit.signatures[5].block_id_flag = 2n;
  assert.equal(checkSelection(args, target, trusted).signatureCount, 5);
});

test("insufficient target signatures and malformed selected identities remain errors", () => {
  const { args } = scenario(65, [...Array<bigint>(64).fill(1n), 100n]);
  for (
    const signature of args.header.signedHeader.commit.signatures.slice(43)
  ) signature.block_id_flag = 1n;
  assert.throws(
    () => prepareCachedHeader(args),
    /Available signatures do not satisfy both quorum rules/,
  );
  args.header.signedHeader.commit.signatures[0].validator_address = "ff".repeat(
    20,
  );
  assert.throws(
    () => prepareCachedHeader(args),
    /Invalid committing signature identity/,
  );
});

test("same-root and adjacent updates retain their target-power prefix", () => {
  const { args } = scenario(65);
  assert.deepEqual(
    decodeCachedUpdate(prepareCachedHeader(args).redeemer)!.signers,
    Array.from({ length: 44 }, (_, i) => i),
  );
  args.header.signedHeader.header.height = 11n;
  args.header.signedHeader.commit.height = 11n;
  assert.equal(prepareCachedHeader(args).candidateCount, 1);
});

test("large trusted powers use exact integer quorum arithmetic", () => {
  const { args, target, trusted } = scenario(12, [
    9n,
    8n,
    7n,
    6n,
    5n,
    4n,
    3n,
    2n,
    1n,
    1n,
    1n,
    1n,
  ]);
  for (const validator of args.header.trustedValidators.validators) {
    validator.votingPower *= 10_000_000_000_000n;
  }
  for (const leaf of trusted) leaf.power *= 10_000_000_000_000n;
  args.trustedRoot = cacheRecord(trusted).root;
  args.cache.records = [cacheRecord(target), cacheRecord(trusted)];
  checkSelection(args, target, trusted);
});

test("keys outside the trusted set receive no overlap credit", () => {
  const { args, target, trusted } = scenario(8);
  trusted[0] = { ...trusted[0], pubkey: digest("trusted-only"), power: 10n };
  const old = canonical(trusted);
  args.header.trustedValidators.validators = old.map((leaf) => ({
    pubkey: leaf.pubkey,
    address: address(leaf.pubkey),
    votingPower: leaf.power,
  }));
  args.trustedRoot = cacheRecord(old).root;
  args.cache.records = [cacheRecord(target), cacheRecord(old)];
  const result = checkSelection(args, target, old);
  assert.equal(result.signatureCount, 6);
  assert(!decodeCachedUpdate(result.redeemer)!.signers.includes(0));
});

test("equal-size quorums rank complete witness size after reducing trusted memberships", () => {
  const { args, target, trusted } = scenario(10, [
    11n,
    23n,
    14n,
    7n,
    2n,
    22n,
    21n,
    22n,
    2n,
    7n,
  ]);
  const result = checkSelection(args, target, trusted);
  assert.equal(result.signatureCount, 7);
  assert.equal(cachedProofs(result.redeemer).trusted.length, 2);
  assert(
    result.redeemer.length <
      allOverlapRedeemer(result.redeemer, trusted).length,
  );
  for (
    let signerCandidate = 1;
    signerCandidate < result.candidateCount;
    signerCandidate++
  ) {
    const other = checkSelection({ ...args, signerCandidate }, target, trusted);
    assert.equal(other.signatureCount, 7);
    assert(result.redeemer.length <= other.redeemer.length);
  }
});

test("invalid candidate positions are rejected", () => {
  const { args } = scenario(6);
  for (const signerCandidate of [-1, 1, 0.5, NaN]) {
    assert.throws(
      () => prepareCachedHeader({ ...args, signerCandidate }),
      /Invalid cached signer candidate/,
    );
  }
});

test("weighted choices preserve both quorums across partial signer availability", () => {
  for (let seed = 1; seed <= 24; seed++) {
    const { args, target, trusted } = scenario(
      12,
      Array.from({ length: 12 }, (_, i) => BigInt((seed * (i + 3)) % 19 + 1)),
    );
    const weighted = canonical(
      target.map((leaf, i) => ({
        ...leaf,
        power: BigInt((seed * (i + 7)) % 13 + 1),
      })),
    );
    const signatures = new Map(
      args.header.signedHeader.commit.signatures.map((
        signature,
      ) => [signature.validator_address, signature]),
    );
    args.header.validatorSet.validators = weighted.map((leaf) => ({
      pubkey: leaf.pubkey,
      address: address(leaf.pubkey),
      votingPower: leaf.power,
    }));
    args.header.signedHeader.header.validatorsHash = cacheRecord(weighted).root;
    args.header.signedHeader.commit.signatures = weighted.map((leaf, i) => ({
      ...signatures.get(address(leaf.pubkey))!,
      block_id_flag: (seed + i) % 7 === 0 ? 1n : 2n,
    }));
    args.cache.records = [cacheRecord(weighted), cacheRecord(trusted)];
    const available = weighted.filter((leaf) =>
      args.header.signedHeader.commit.signatures[leaf.index].block_id_flag ===
        2n
    );
    const old = new Map(trusted.map((leaf) => [leaf.pubkey, leaf.power]));
    if (
      available.reduce((sum, leaf) => sum + leaf.power, 0n) * 3n <=
        cacheRecord(weighted).totalPower * 2n ||
      available.reduce((sum, leaf) => sum + old.get(leaf.pubkey)!, 0n) * 3n <=
        cacheRecord(trusted).totalPower
    ) {
      assert.throws(
        () => prepareCachedHeader(args),
        /Available signatures do not satisfy both quorum rules/,
      );
    } else {
      const result = checkSelection(args, weighted, trusted);
      for (
        let signerCandidate = 1;
        signerCandidate < result.candidateCount;
        signerCandidate++
      ) checkSelection({ ...args, signerCandidate }, weighted, trusted);
    }
  }
});
