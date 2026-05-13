import { assertEquals } from "@std/assert";
import type { Script } from "@lucid-evolution/lucid";

import {
  buildReferenceValidatorBatches,
  buildReferenceValidatorSizeReport,
} from "./deployment.ts";

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
