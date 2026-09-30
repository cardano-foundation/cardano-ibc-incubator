import { deploymentScenario } from "./testing/shutdown-model.ts";
for (const populated of [false, true]) {
  Deno.test(`main complete shutdown populated=${populated}`, async () => {
    const scenario = await deploymentScenario();
    try {
      if (populated) {
        const client = await scenario.createClient(7);
        await scenario.createConnection(client);
        await scenario.createChannel(12, true);
        await scenario.createChannel(20, false);
        await scenario.topUp(7_000_000n);
      }
      await scenario.enter(1);
      await scenario.rejectPrematureCleanup(1);
      await scenario.waitForGrace();
      await scenario.finish();
    } finally {
      scenario.dispose();
    }
  });
}
