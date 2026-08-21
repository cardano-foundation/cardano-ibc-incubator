import { assertEquals, assertThrows } from "@std/assert";
import {
  ceilToLedgerSlotStart,
  deploymentReferenceOutRefs,
  encodeHostStateSealModuleRedeemer,
  isRetiredModulePortKey,
  parseDeployment,
  requireKupoPatternCoverage,
  retiredModulePortKey,
} from "./shutdown-deployment.ts";

function schemaV6Deployment() {
  return {
    schemaVersion: 6,
    hostStateNFT: {
      policyId: "11".repeat(28),
      name: "6962635f686f73745f7374617465",
      script: "590100",
    },
    validators: {
      hostStateStt: {
        refUtxo: { txHash: "aa".repeat(32), outputIndex: 0 },
      },
      spendClient: {
        refUtxo: { txHash: "bb".repeat(32), outputIndex: 1 },
      },
      mintLifecycleReclamationMarker: {
        scriptHash: "44".repeat(28),
        refUtxo: { txHash: "cc".repeat(32), outputIndex: 2 },
      },
      mintLifecycleCreationMarker: {
        scriptHash: "45".repeat(28),
        refUtxo: { txHash: "dd".repeat(32), outputIndex: 3 },
      },
      mintLifecycleOperationalMarker: {
        scriptHash: "46".repeat(28),
        refUtxo: { txHash: "ee".repeat(32), outputIndex: 4 },
      },
      mintLifecyclePacketMarker: {
        scriptHash: "47".repeat(28),
        refUtxo: { txHash: "ff".repeat(32), outputIndex: 5 },
      },
      duplicateHost: {
        refUtxo: { txHash: "aa".repeat(32), outputIndex: 0 },
      },
    },
  };
}

Deno.test("shutdown accepts only a reclaimable schema-v6 deployment", () => {
  const deployment = schemaV6Deployment();
  assertEquals(
    parseDeployment(deployment) as unknown,
    deployment as unknown,
  );

  assertThrows(
    () => parseDeployment({ ...deployment, schemaVersion: 5 }),
    Error,
    "fresh schema-v6 deployment",
  );
  assertThrows(
    () =>
      parseDeployment({
        ...deployment,
        hostStateNFT: { ...deployment.hostStateNFT, script: undefined },
      }),
    Error,
    "minting script",
  );
});

for (
  const [name, label] of [
    ["mintLifecycleCreationMarker", "creation"],
    ["mintLifecycleReclamationMarker", "reclamation"],
    ["mintLifecycleOperationalMarker", "operational"],
    ["mintLifecyclePacketMarker", "packet"],
  ] as const
) {
  Deno.test(`shutdown requires the lifecycle ${label} policy reference`, () => {
    const missingPolicy = structuredClone(schemaV6Deployment());
    delete (missingPolicy.validators as Record<string, unknown>)[name];
    assertThrows(
      () => parseDeployment(missingPolicy),
      Error,
      `lifecycle ${label} policy`,
    );

    const missingReference = structuredClone(schemaV6Deployment());
    delete (
      missingReference.validators[name] as Record<string, unknown>
    ).refUtxo;
    assertThrows(
      () => parseDeployment(missingReference),
      Error,
      `lifecycle ${label} policy does not contain a valid reference output`,
    );
  });
}

Deno.test("shutdown tracks only the deployment's unique reference outputs", () => {
  assertEquals(
    deploymentReferenceOutRefs(
      schemaV6Deployment() as unknown as ReturnType<typeof parseDeployment>,
    ),
    [
      { txHash: "aa".repeat(32), outputIndex: 0 },
      { txHash: "bb".repeat(32), outputIndex: 1 },
      { txHash: "cc".repeat(32), outputIndex: 2 },
      { txHash: "dd".repeat(32), outputIndex: 3 },
      { txHash: "ee".repeat(32), outputIndex: 4 },
      { txHash: "ff".repeat(32), outputIndex: 5 },
    ],
  );
});

Deno.test("shutdown encodes the stable module seal callback", () => {
  assertEquals(
    encodeHostStateSealModuleRedeemer(),
    "d8799fd9050480ff",
  );
});

Deno.test("shutdown marks a reclaimed module without losing its original port", () => {
  const portId = "7472616e73666572";
  const retired = retiredModulePortKey(portId);
  assertEquals(retired, `00${portId}`);
  assertEquals(isRetiredModulePortKey(portId), false);
  assertEquals(isRetiredModulePortKey(retired), true);
  assertEquals(isRetiredModulePortKey("00"), false);
  assertEquals(isRetiredModulePortKey("00ff"), false);
  assertThrows(() => retiredModulePortKey("ff"), Error, "Invalid active");
});

Deno.test("shutdown writes exact ledger-slot timestamps into HostState", () => {
  const toSlot = (unixTime: number) => Math.floor(unixTime / 1_000);
  const toTime = (slot: number) => slot * 1_000;
  assertEquals(ceilToLedgerSlotStart(2_000, toSlot, toTime), 2_000);
  assertEquals(ceilToLedgerSlotStart(2_001, toSlot, toTime), 3_000);
});

Deno.test("shutdown rejects an empty or malformed Kupo coverage response", () => {
  requireKupoPatternCoverage(["addr_test1..."], "addr_test1...");
  assertThrows(
    () => requireKupoPatternCoverage([], "addr_test1..."),
    Error,
    "does not index",
  );
  assertThrows(
    () => requireKupoPatternCoverage([1], "addr_test1..."),
    Error,
    "Malformed",
  );
});
