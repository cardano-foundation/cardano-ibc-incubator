import { assertEquals } from "jsr:@std/assert";
import type { Script } from "@lucid-evolution/lucid";

import { buildReferenceValidatorBatches } from "./deployment.ts";

const makeValidator = (byteLength: number): Script => ({
  type: "PlutusV3",
  script: "ab".repeat(byteLength),
});

Deno.test("buildReferenceValidatorBatches groups validators within the tx budget", () => {
  const validators = [
    makeValidator(100),
    makeValidator(100),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 4_600);

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

  const batches = buildReferenceValidatorBatches(validators, 4_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 1]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [1, 1],
  );
});
