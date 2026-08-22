import { assertMatch } from "@std/assert";
import { Data } from "@lucid-evolution/lucid";

import { HostStateRedeemer } from "./HostStateRedeemer.ts";

Deno.test("HostState module lifecycle redeemers retain append-only constructor indexes", () => {
  const updateModule = Data.to(
    { UpdateModuleState: { port_id: "bb" } },
    HostStateRedeemer,
    { canonical: true },
  );
  const reclaimModule = Data.to(
    { ReclaimModule: { port_id: "cc" } },
    HostStateRedeemer,
    { canonical: true },
  );

  assertMatch(updateModule, /^d9050c81/);
  assertMatch(reclaimModule, /^d9050d81/);
});
