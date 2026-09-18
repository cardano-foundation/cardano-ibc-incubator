/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import fc from "fast-check";
import { assertEquals } from "@std/assert";
import { deploymentScenario } from "./shutdown-model.ts";

type Model = {
  phase: "active" | "grace" | "ready";
  allocatedClients: number;
  inventory: Record<string, number>;
};
type Real = Awaited<ReturnType<typeof deploymentScenario>>;
type Action = { kind: string; value: number; ordered: boolean };
class Command implements fc.AsyncCommand<Model, Real> {
  constructor(readonly action: Action) {}
  check(model: Readonly<Model>) {
    const { kind } = this.action;
    if (["client", "channel", "top-up", "enter"].includes(kind)) {
      return model.phase === "active";
    }
    if (kind === "connection") {
      return model.phase === "active" && model.allocatedClients > 0;
    }
    if (kind === "wait" || kind === "reject-early") {
      return model.phase === "grace";
    }
    if (kind === "cleanup") return model.phase === "ready";
    return true;
  }
  async run(model: Model, real: Real) {
    const { kind, value, ordered } = this.action;
    switch (kind) {
      case "client":
        await real.createClient(value);
        model.allocatedClients++;
        model.inventory.client++;
        break;
      case "connection":
        await real.createConnection(BigInt(value % model.allocatedClients));
        model.inventory.connection++;
        break;
      case "channel":
        await real.createChannel(value, ordered);
        model.allocatedClients++;
        model.inventory.client++;
        model.inventory.connection++;
        model.inventory.channel++;
        break;
      case "top-up":
        await real.topUp(BigInt(value) * 1_000_000n);
        break;
      case "enter":
        await real.enter(value % 3 + 1);
        await real.rejectPrematureCleanup();
        model.phase = "grace";
        break;
      case "wait":
        await real.waitForGrace();
        model.phase = "ready";
        break;
      case "cleanup": {
        const removed = await real.cleanup(value);
        if (removed) model.inventory[removed]--;
        break;
      }
      case "reject-early":
        await real.rejectPrematureCleanup(value);
        break;
      case "observe":
        real.lucid.overrideUTxOs([]);
        break;
    }
    assertEquals(
      await real.inventory(),
      model.inventory,
      `Inventory after ${this}`,
    );
  }
  toString() {
    return `${this.action.kind}(${this.action.value},ordered=${this.action.ordered})`;
  }
}
async function checkCase(actions: Action[]) {
  const real = await deploymentScenario();
  const model: Model = {
    phase: "active",
    allocatedClients: 0,
    inventory: {
      client: 0,
      connection: 0,
      channel: 0,
      transfer: 1,
      module: 2,
      trace: 17,
    },
  };
  try {
    assertEquals(await real.inventory(), model.inventory);
    await fc.asyncModelRun(
      () => ({ model, real }),
      actions.map((action) => new Command(action)),
    );
    // Every generated prefix must admit a complete teardown, even an empty prefix
    // or an interruption partway through cleanup. No UTxOs are seeded after genesis.
    if (model.phase === "active") await real.enter(1);
    if (model.phase !== "ready") {
      await real.rejectPrematureCleanup();
      await real.waitForGrace();
    }
    await real.finish();
  } finally {
    real.dispose();
  }
}
function describe(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message) +
      (error.cause ? "\n" + describe(error.cause) : "")
    : String(error);
}
self.onmessage = async ({ data }: MessageEvent<Action[]>) => {
  // Deployment logs are repetitive during shrinking; errors include their causes.
  console.log = () => {};
  try {
    await checkCase(data);
    self.postMessage({});
  } catch (error) {
    self.postMessage({ error: describe(error) });
  }
};
