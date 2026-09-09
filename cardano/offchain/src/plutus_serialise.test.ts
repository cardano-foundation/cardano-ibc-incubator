import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { CML, Constr, Data } from "@lucid-evolution/lucid";
import {
  publicClientCommitmentValues,
  serialisePlutusData,
} from "./plutus_serialise.ts";

// Pinned differential vectors: evaluated with the serialiseData builtin in
// Aiken 1.1.21, not inferred from Lucid/CML's canonical serializer. The final
// test reruns that differential when invoked with --allow-run=aiken.
const vectors: Array<[string, string]> = [
  ["d8798201d8798102", "d8798201d8798102"],
  ["d8799f01d8799f02ffff", "d8799f01d8799f02ffff"],
  ["d879821801d879811802", "d8798201d8798102"],
  ["d87998020102", "d879820102"],
  ["d900798101", "d8798101"],
  ["9f18173800ff", "9f1720ff"],
  ["98020102", "820102"],
  ["b80201020405", "a201020405"],
  ["bf1801180218011803ff", "bf01020103ff"],
  ["a3010204050103", "a3010204050103"],
  ["5f41014102ff", "420102"],
  ["58020102", "420102"],
  ["d866820080", "d866820080"],
  ["d8669f009fffff", "d86682009fff"],
  ["d8669f1880820102ff", "d866821880820102"],
  ["d8668218009800", "d866820080"],
  ["d905008101", "d905008101"],
  ["c249000000000000000001", "c249000000000000000001"],
  ["c35f41004101ff", "c3420001"],
  ["c249010000000000000000", "c249010000000000000000"],
  ["c240", "c240"],
  ["c340", "c340"],
  ["a1c2409fc340ff", "a1c2409fc340ff"],
  ["1bffffffffffffffff", "1bffffffffffffffff"],
  ["3bffffffffffffffff", "3bffffffffffffffff"],
  ["d8669802188080", "d86682188080"],
  ["5840" + "aa".repeat(64), "5840" + "aa".repeat(64)],
  ["5841" + "bb".repeat(65), "5f5840" + "bb".repeat(64) + "41bbff"],
  [
    "5881" + "cc".repeat(129),
    "5f5840" + "cc".repeat(64) + "5840" + "cc".repeat(64) + "41ccff",
  ],
];

Deno.test("public Plutus serialization matches pinned Aiken vectors", () => {
  for (const [input, expected] of vectors) {
    assertEquals(serialisePlutusData(input), expected, input);
  }
});

Deno.test("public serialization preserves extracted mixed-container subtrees", () => {
  const outer = CML.PlutusData.from_cbor_hex("d8799fd87982019f1802ffff");
  const subtree = outer.as_constr_plutus_data()!.fields().get(0);
  assertEquals(serialisePlutusData(subtree), "d87982019f02ff");
  assertNotEquals(
    serialisePlutusData(subtree),
    Data.to<Data>(Data.from(subtree.to_cbor_hex()), undefined, {
      canonical: true,
    }),
  );
  for (const canonical of [true, false]) {
    const encoded = Data.to<Data>(
      new Constr(0, [1n, new Constr(0, [2n])]),
      undefined,
      {
        canonical,
      },
    );
    assertEquals(
      serialisePlutusData(CML.PlutusData.from_cbor_hex(encoded)),
      encoded,
    );
  }
});

Deno.test("public serializer rejects non-Data CBOR instead of extending the format", () => {
  // Real CML rejects these too; the structural stand-in exercises this helper's
  // fail-closed boundary without weakening CML's public parameter type.
  for (const raw of ["f5", "6161", "c080", "d87900", "d8668100"]) {
    const input = {
      to_cbor_bytes: () =>
        Uint8Array.from(raw.match(/../g)!, (b) => parseInt(b, 16)),
    } as CML.PlutusData;
    assertThrows(() => serialisePlutusData(input), Error, "non-Plutus");
  }
  const trailing = {
    to_cbor_bytes: () => new Uint8Array([0, 0]),
  } as CML.PlutusData;
  assertThrows(() => serialisePlutusData(trailing), Error, "trailing");
  for (const raw of ["", "0", "zz", "01\n"]) {
    assertThrows(() => serialisePlutusData(raw), Error, "CBOR hex");
  }
});

Deno.test("public leaf extraction preserves raw bignums and container variants", () => {
  const client = "d8799fc24900000000000000000102030405060708ff";
  const consensus = "d87983015f41014102ffd879814100";
  const wrap = (map: string, outer = "d87982") =>
    outer +
    "d87982d87984" + client + map + "a0a0d879824040" + "5820" + "00".repeat(32);
  const raw = wrap("a100" + consensus);
  assertEquals(publicClientCommitmentValues(raw), {
    clientValue: client,
    consensusValue: "d8798301420102d879814100",
  });
  assertEquals(
    publicClientCommitmentValues(wrap("a100" + consensus, "d866820082")),
    publicClientCommitmentValues(raw),
  );
  assertThrows(
    () => publicClientCommitmentValues(wrap("a0")),
    Error,
    "exactly",
  );
  assertThrows(
    () =>
      publicClientCommitmentValues(wrap("a200" + consensus + "00" + consensus)),
    Error,
    "exactly",
  );
  assertThrows(
    () => publicClientCommitmentValues("d87a80"),
    Error,
    "prototype",
  );
});

Deno.test({
  name:
    "public serialization differential against the installed Aiken evaluator",
  // No dependency on Aiken for the ordinary offchain test run. Explicitly run:
  // deno test --allow-env --allow-read --allow-run=aiken src/plutus_serialise.test.ts
  ignore:
    (await Deno.permissions.query({ name: "run", command: "aiken" })).state !==
      "granted",
  async fn() {
    for (const [input, expected] of vectors) {
      const data = Uint8Array.from(input.match(/../g)!, (b) => parseInt(b, 16));
      // Flat-encoded: (program 1.0.0 [(builtin serialiseData) (con data <input>)]).
      // Each vector is <256 bytes, hence exactly one Flat bytestring chunk.
      assertEquals(data.length < 256, true);
      const program = new Uint8Array([
        1,
        0,
        0,
        0x37,
        0x66,
        0x98,
        1,
        data.length,
        ...data,
        0,
        1,
      ]);
      const child = new Deno.Command("aiken", {
        args: ["uplc", "eval", "--flat", "/dev/stdin"],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter();
      await writer.write(program);
      await writer.close();
      const result = await child.output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      const actual = JSON.parse(new TextDecoder().decode(result.stdout)).result;
      assertEquals(
        actual.replace(/\s+/g, " ").replace(" )", ")"),
        `(con bytestring #${expected})`,
        input,
      );
    }
  },
});
