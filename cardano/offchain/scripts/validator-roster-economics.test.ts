import { assertEquals } from "@std/assert";
import { rosterEconomics } from "./validator-roster-economics.ts";

Deno.test("roster economics subtracts changed-set costs from recurring hit savings", () => {
  const result = rosterEconomics(500000, 40000);
  assertEquals(result.netSavingPerUpdateLovelace, 284000);
  assertEquals(result.monthlySavingLovelace, 1704000000);
  assertEquals(result.clearsFivePercentHurdle, true);
  assertEquals(rosterEconomics(500000, 40001).clearsFivePercentHurdle, false);
});

Deno.test("locked capital is not subtracted as a fee on every update", () => {
  assertEquals(rosterEconomics(500000, 0).netSavingPerUpdateLovelace, 300000);
  assertEquals(
    rosterEconomics(300000, 500000).netSavingPerUpdateLovelace,
    -20000,
  );
});
