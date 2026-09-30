import { runOperatorPopulation } from "../../../cardano/offchain/src/testing/migration-operator.ts";
const results: Awaited<ReturnType<typeof runOperatorPopulation>>[] = [];
async function record(
  shards: number,
  cached: boolean,
  interrupt = false,
  channels = 1,
  packetEntries = 2,
) {
  const result = await runOperatorPopulation(
    shards,
    cached,
    interrupt,
    channels,
    packetEntries,
  );
  results.push(result);
  console.log(JSON.stringify(result));
}
for (const shards of [2, 8, 32, 128]) {
  for (const cached of [false, true]) {
    await record(shards, cached);
  }
}
// Measure a cache loss after the first escrow move, and a larger complete
// inventory with multiple channels. These remain seeded emulator populations,
// not a claim about network confirmation latency or real packet creation.
await record(128, true, true, 1, 32);
await record(512, true, false, 8, 32);
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
