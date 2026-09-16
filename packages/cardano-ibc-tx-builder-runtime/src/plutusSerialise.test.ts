import assert from "node:assert/strict";
import { test } from "node:test";
import { CML, Constr, Data } from "@lucid-evolution/lucid";
import {
  publicClientCommitmentValues,
  serialisePlutusData,
} from "./plutusSerialise.ts";
import {
  ConsensusHistoryCommitment,
  consensusHistoryKey,
  encodeConsensusHistoryRecord,
} from "./consensusHistory.ts";

// Derived from the ledger's PlutusCore/Data.hs encodeData/encodeInteger/encodeBs
// and cborg's defaultEncodeList, not the encoding-preserving Aiken <=1.1.21 CEK.
const vectors: Array<[string, string]> = [
  ["d8798201d8798102", "d8799f01d8799f02ffff"],
  ["d8799f01d8799f02ffff", "d8799f01d8799f02ffff"],
  ["d879821801d879811802", "d8799f01d8799f02ffff"],
  ["d87998020102", "d8799f0102ff"],
  ["d900798101", "d8799f01ff"],
  ["d8799fff", "d87980"],
  ["d87980", "d87980"],
  ["9fff", "80"],
  ["9800", "80"],
  ["98020102", "9f0102ff"],
  ["9f18173800ff", "9f1720ff"],
  ["bfff", "a0"],
  ["b80201020405", "a201020405"],
  ["bf1801180218011803ff", "a201020103"],
  ["a3010204050103", "a3010204050103"],
  ["a204050102", "a204050102"],
  ["a2c24101020103", "a201020103"],
  ["5fff", "40"],
  ["5f41014102ff", "420102"],
  ["58020102", "420102"],
  ["d866820080", "d87980"],
  ["d8669f009fffff", "d87980"],
  ["d8668200820103", "d8799f0103ff"],
  ["d8668218009800", "d87980"],
  ["d866820680", "d87f80"],
  ["d866820780", "d9050080"],
  ["d86682187f80", "d9057880"],
  ["d86682188080", "d86682188080"],
  ["d8669f1880820102ff", "d8668218809f0102ff"],
  ["d866821bffffffffffffffff80", "d866821bffffffffffffffff80"],
  ["d905008101", "d905009f01ff"],
  ["c249000000000000000001", "01"],
  ["c35f41004101ff", "21"],
  ["c240", "00"],
  ["c340", "20"],
  ["c24100", "00"],
  ["c34100", "20"],
  ["c248ffffffffffffffff", "1bffffffffffffffff"],
  ["c348ffffffffffffffff", "3bffffffffffffffff"],
  ["c249010000000000000000", "c249010000000000000000"],
  ["c349010000000000000000", "c349010000000000000000"],
  ["a1c2409fc340ff", "a1009f20ff"],
  ["1bffffffffffffffff", "1bffffffffffffffff"],
  ["3bffffffffffffffff", "3bffffffffffffffff"],
  ["5840" + "aa".repeat(64), "5840" + "aa".repeat(64)],
  [
    "5f5820" + "bb".repeat(32) + "5821" + "bb".repeat(33) + "ff",
    "5f5840" + "bb".repeat(64) + "41bbff",
  ],
  [
    "5f5840" + "cc".repeat(64) + "583f" + "cc".repeat(63) + "42ccccff",
    "5f5840" + "cc".repeat(64) + "5840" + "cc".repeat(64) + "41ccff",
  ],
  [
    "c25f5840" + "00".repeat(63) + "01" + "5840" + "00".repeat(64) + "ff",
    "c25f584001" + "00".repeat(63) + "4100ff",
  ],
];

test("public serialization matches ledger normalization vectors and is idempotent", () => {
  for (const [input, expected] of vectors) {
    assert.equal(serialisePlutusData(input), expected, input);
    assert.equal(
      serialisePlutusData(expected),
      expected,
      `idempotent ${input}`,
    );
  }
});

test("public serialization ignores constructor-container variants from CML", () => {
  const outer = CML.PlutusData.from_cbor_hex("d8799fd87982019f1802ffff");
  const subtree = outer.as_constr_plutus_data()!.fields().get(0);
  assert.equal(serialisePlutusData(subtree), "d8799f019f02ffff");
  for (const canonical of [true, false]) {
    const encoded = Data.to<Data>(
      new Constr(0, [1n, new Constr(0, [2n])]),
      undefined,
      { canonical },
    );
    assert.equal(
      serialisePlutusData(CML.PlutusData.from_cbor_hex(encoded)),
      "d8799f01d8799f02ffff",
    );
  }
});

test("public serialization rejects non-Data and malformed constructor aliases", () => {
  for (
    const raw of [
      "f5",
      "6161",
      "c080",
      "d87900",
      "d8668100",
      "d86683008080",
      "d866822080",
      "d86682c2410080",
    ]
  ) {
    assert.throws(() => serialisePlutusData(raw), /non-Plutus/, raw);
  }
  assert.throws(() => serialisePlutusData("0000"), /trailing/);
  for (const raw of ["", "0", "zz", "01\n"]) {
    assert.throws(() => serialisePlutusData(raw), /CBOR hex/);
  }
});

test("public leaf extraction normalizes tagged integers and every outer-container variant", () => {
  const client = "d8799fc24900000000000000000102030405060708ff";
  const consensus = "d87983015f41014102ffd879814100";
  const wrap = (map: string, outer = "d87982") =>
    outer +
    "d87982d87984" + client + map + "a0a0d879824040" + "5820" + "00".repeat(32);
  const raw = wrap("a100" + consensus);
  const expected = {
    clientValue: "d8799f0102030405060708ff",
    consensusValue: "d8799f01420102d8799f4100ffff",
  };
  assert.deepEqual(publicClientCommitmentValues(raw), expected);
  assert.deepEqual(
    publicClientCommitmentValues(wrap("a100" + consensus, "d866820082")),
    expected,
  );
  const production = "d87983d87984" + client + "a100" + consensus +
    "a0a0d8798240405820" + "00".repeat(32);
  assert.deepEqual(
    publicClientCommitmentValues(production, "production"),
    expected,
  );
  for (const map of ["a0", "a200" + consensus + "00" + consensus]) {
    assert.throws(() => publicClientCommitmentValues(wrap(map)), /exactly/);
  }
  assert.throws(() => publicClientCommitmentValues("d87a80"), /prototype/);
});

test("ledger public normalization leaves the private history key, value and root ABI unchanged", async () => {
  const record = {
    clientToken: { policyId: "11".repeat(28), name: "22" },
    height: { revisionNumber: 0n, revisionHeight: 1n },
    consensusState: { timestamp: 7n, nextValidatorsHash: "cc", root: "dd" },
    processedTime: 8n,
    processedHeight: 9n,
  };
  const key = "internal/consensus-history/v1/" +
    "d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffff";
  const value =
    "d8799fd8799f581c111111111111111111111111111111111111111111111111111111114122ffd8799f0001ffd8799f0741ccd8799f41ddffff0809ff";
  assert.equal(consensusHistoryKey(record.clientToken, record.height), key);
  assert.equal(encodeConsensusHistoryRecord(record), value);
  const tree = new ConsensusHistoryCommitment();
  tree.append(record);
  assert.equal(
    (await tree.witness(record.clientToken, record.height)).root,
    "caee7ebf5c9bd19dc904e771797ce4e98f91301273dd86c9f32dc8c8a4fc6e7f",
  );
});
