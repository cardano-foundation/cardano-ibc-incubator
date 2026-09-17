import { runOperatorPopulation } from "../../cardano/offchain/src/testing/migration-operator.ts";
const results = [];
for (const shards of [2, 8, 32, 128]) {
  for (const cached of [false, true]) {
    const result = await runOperatorPopulation(shards, cached);
    results.push(result);
    console.log(JSON.stringify(result));
  }
}
await Deno.writeTextFile(
  Deno.args[0],
  JSON.stringify(
    {
      scope:
        "Seeded initial population; production operator and actual UPLC evaluation of every approval and migration transaction. Local emulator wall time, not chain confirmation latency or two-chain acceptance.",
      results,
    },
    null,
    2,
  ) + "\n",
);
