import { assertEquals, assertMatch } from "@std/assert";
import { Data } from "@lucid-evolution/lucid";

import { HostStateDatum } from "./HostState.ts";
import { HostStateRedeemer } from "./HostStateRedeemer.ts";

Deno.test("HostState reference count codec preserves unregistered and registered states", () => {
  const datum = {
    state: {
      version: 0n,
      ibc_state_root: "00".repeat(32),
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: new Map(),
      last_update_time: 1n,
      live_client_count: 0n,
      live_connection_count: 0n,
      live_channel_count: 0n,
    },
    nft_policy: "11".repeat(28),
    deployer: "22".repeat(28),
    shutdown: "Active" as const,
    live_reference_script_count: null,
    reference_script_inventory_root: "00".repeat(32),
    reference_script_registration: null,
  };

  for (const count of [null, 3n]) {
    const expected = count === null ? datum : {
      ...datum,
      live_reference_script_count: count,
      reference_script_inventory_root: "33".repeat(32),
      reference_script_registration: {
        target_count: 3n,
        target_root: "33".repeat(32),
        last_out_ref: {
          transaction_id: "44".repeat(32),
          output_index: 2n,
        },
      },
    };
    assertEquals(
      Data.from(Data.to(expected, HostStateDatum), HostStateDatum),
      expected,
    );
  }
});

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

Deno.test("HostState reference lifecycle redeemers use appended constructor indexes", () => {
  const registerReferences = Data.to(
    {
      RegisterReferenceScripts: {
        target_count: 3n,
        target_root: "33".repeat(32),
        batch_out_refs: [{
          transaction_id: "44".repeat(32),
          output_index: 2n,
        }],
      },
    },
    HostStateRedeemer,
    { canonical: true },
  );
  const reclaimReferences = Data.to(
    { ReclaimReferenceScripts: { predecessor_root: "33".repeat(32) } },
    HostStateRedeemer,
    { canonical: true },
  );
  const finalizeRegistration = Data.to(
    "FinalizeReferenceScriptRegistration",
    HostStateRedeemer,
    { canonical: true },
  );

  assertMatch(registerReferences, /^d9050e83/);
  assertMatch(reclaimReferences, /^d9050f81/);
  assertMatch(finalizeRegistration, /^d9051080/);
});
