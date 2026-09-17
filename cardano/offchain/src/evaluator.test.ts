import { assertEquals } from "@std/assert";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

Deno.test("Lucid and utils resolve the checksum-pinned evaluator correction", async () => {
  const require = createRequire(import.meta.url);
  const hashes = JSON.parse(
    await Deno.readTextFile(
      new URL("../../vendor/uplc/artifact-sha256.json", import.meta.url),
    ),
  );
  for (const consumer of ["@lucid-evolution/lucid", "@lucid-evolution/utils"]) {
    const evaluator = createRequire(require.resolve(consumer)).resolve(
      "@lucid-evolution/uplc",
    );
    for (const name of ["uplc_tx.js", "uplc_tx_bg.wasm"]) {
      const bytes = await Deno.readFile(join(dirname(evaluator), name));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const actual = Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
        .join("");
      assertEquals(actual, hashes[`dist/node/${name}`], consumer);
    }
  }
});
