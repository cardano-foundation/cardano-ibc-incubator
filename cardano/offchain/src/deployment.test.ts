import { assertEquals } from "@std/assert";
import { Data, type Script } from "@lucid-evolution/lucid";

import {
  buildReferenceValidatorBatches,
  buildReferenceValidatorSizeReport,
  DeploymentIbcTree,
} from "./deployment.ts";

const makeValidator = (byteLength: number): Script => ({
  type: "PlutusV3",
  script: "ab".repeat(byteLength),
});

const EMPTY_HASH = "00".repeat(32);

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes as unknown as BufferSource,
      ),
    ),
  );

const expectedSingleLeafRoot = async (
  key: string,
  valueHex: string,
): Promise<string> => {
  const keyHash = await sha256Hex(new TextEncoder().encode(key));
  const valueHash = await sha256Hex(hexToBytes(valueHex));
  let current = await sha256Hex(
    concatBytes(
      new Uint8Array([0]),
      hexToBytes(keyHash),
      hexToBytes(valueHash),
    ),
  );
  let index = BigInt(`0x${keyHash.slice(0, 16)}`);

  for (let depth = 0; depth < 64; depth += 1) {
    const currentBytes = hexToBytes(current);
    current = (index & 1n) === 0n
      ? await sha256Hex(
        concatBytes(new Uint8Array([1]), currentBytes, hexToBytes(EMPTY_HASH)),
      )
      : await sha256Hex(
        concatBytes(new Uint8Array([1]), hexToBytes(EMPTY_HASH), currentBytes),
      );
    index >>= 1n;
  }

  return current;
};

Deno.test("buildReferenceValidatorBatches groups validators within the tx budget", () => {
  const validators = [
    makeValidator(100),
    makeValidator(100),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 5_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 2]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [2, 1],
  );
});

Deno.test("buildReferenceValidatorBatches keeps an oversized validator in its own batch", () => {
  const validators = [
    makeValidator(900),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 5_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 1]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [1, 1],
  );
});

Deno.test("buildReferenceValidatorSizeReport allows single validators that exceed the batch budget", () => {
  const validators = [
    makeValidator(1_200),
    makeValidator(100),
  ];

  const report = buildReferenceValidatorSizeReport(validators, 5_600);

  assertEquals(report[0].index, 0);
  assertEquals(report[0].scriptBytes, 1_200);
  assertEquals(report[0].estimatedReferenceOutputBytes, 1_400);
  assertEquals(report[0].oversized, false);
  assertEquals(report[1].oversized, false);
});

Deno.test("buildReferenceValidatorSizeReport flags validators that cannot fit alone", () => {
  const validators = [
    makeValidator(5_000),
    makeValidator(100),
  ];

  const report = buildReferenceValidatorSizeReport(validators, 5_600);

  assertEquals(report[0].index, 0);
  assertEquals(report[0].scriptBytes, 5_000);
  assertEquals(report[0].estimatedReferenceOutputBytes, 5_200);
  assertEquals(report[0].oversized, true);
  assertEquals(report[1].oversized, false);
});

Deno.test("DeploymentIbcTree commits leaves with key hash included", async () => {
  const tree = new DeploymentIbcTree();
  const key = "ports/port-100";
  const value = Data.to(100n as never, Data.Integer() as never, {
    canonical: true,
  });

  tree.set(key, value);

  assertEquals(await tree.getRoot(), await expectedSingleLeafRoot(key, value));
});
