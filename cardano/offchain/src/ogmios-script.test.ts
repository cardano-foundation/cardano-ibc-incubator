import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  CML,
  type Script,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { Cbor, CborBytes, CborTag } from "@harmoniclabs/cbor";
import { toOgmiosScript } from "./ogmios-script.ts";

Deno.test("Ogmios tagged script encoding preserves language and exact ledger hash", () => {
  // Minimal valid Flat program, wrapped once by CBOR. No emulator or evaluator
  // participates in the independent decode/hash check.
  for (const type of ["PlutusV1", "PlutusV2", "PlutusV3"] as const) {
    const script: Script = { type, script: "49480100002221200101" };
    const encoded = toOgmiosScript(script)!;
    const tagged = Cbor.parse(encoded);
    assert(tagged instanceof CborTag && tagged.tag === 24n);
    assert(tagged.data instanceof CborBytes);
    const decoded = CML.Script.from_cbor_bytes(tagged.data.bytes);
    assertEquals(decoded.hash().to_hex(), validatorToScriptHash(script));
    assertEquals(
      decoded.kind(),
      type === "PlutusV1" ? 1 : type === "PlutusV2" ? 2 : 3,
    );
  }
});

Deno.test("Ogmios script encoding retains native scripts and rejects unknown types", () => {
  const native: Script = {
    type: "Native",
    script: "8200581c" + "11".repeat(28),
  };
  const tagged = Cbor.parse(toOgmiosScript(native)!);
  assert(tagged instanceof CborTag && tagged.data instanceof CborBytes);
  assertEquals(
    CML.Script.from_cbor_bytes(tagged.data.bytes).hash().to_hex(),
    validatorToScriptHash(native),
  );
  assertEquals(toOgmiosScript(undefined), null);
  assertThrows(() =>
    toOgmiosScript({ type: "Unknown", script: "00" } as unknown as Script)
  );
});
