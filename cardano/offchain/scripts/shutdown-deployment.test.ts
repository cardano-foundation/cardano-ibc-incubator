import { assertEquals, assertThrows } from "@std/assert";
import {
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  compareReferenceScriptInventoryEntries,
  EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT,
  foldReferenceScriptInventory,
} from "../src/utils.ts";
import {
  buildReclaimedReferenceHostDatum,
  buildSealedHostDatum,
  buildShutdownEntryDatum,
  ceilToLedgerSlotStart,
  deploymentReferenceOutRefs,
  encodeHostStateSealModuleRedeemer,
  isRetiredModulePortKey,
  lifecycleTransitionTiming,
  parseDeployment,
  parseOgmiosLiveReferenceOutRefs,
  reconcileReferenceUtxoViews,
  redactManagedCredentials,
  requireAuthenticatedReferenceInventory,
  requireKupoPatternCoverage,
  requireRegisteredReferenceCount,
  retiredModulePortKey,
  selectReferenceReclaimSuffix,
} from "./shutdown-deployment.ts";

const REQUIRED_REFERENCE_VALIDATORS = [
  "spendClient",
  "spendConnection",
  "spendChannel",
  "spendTransferModule",
  "spendMockModule",
  "mintIdentifier",
  "spendTraceRegistry",
  "mintVoucher",
  "mintTransferEscrowShard",
  "mintPort",
  "verifyProof",
  "hostStateStt",
  "mintClientStt",
  "mintConnectionStt",
  "mintChannelStt",
  "mintLifecycleCreationMarker",
  "mintLifecycleReclamationMarker",
  "mintLifecycleOperationalMarker",
  "mintLifecyclePacketMarker",
] as const;

const REQUIRED_CHANNEL_REFERENCE_VALIDATORS = [
  "chan_open_ack",
  "chan_open_confirm",
  "chan_close_init",
  "chan_close_confirm",
  "recv_packet",
  "send_packet",
  "timeout_packet",
  "acknowledge_packet",
  "prune_packet_history",
] as const;

const ADDRESS_BEARING_REFERENCE_VALIDATORS = new Set<string>([
  "spendClient",
  "spendConnection",
  "spendChannel",
  "spendTransferModule",
  "spendMockModule",
  "spendTraceRegistry",
  "hostStateStt",
]);

const TEST_SCRIPT = "590100";
const TEST_SCRIPT_HASH = validatorToScriptHash({
  type: "PlutusV3",
  script: TEST_SCRIPT,
});

function referenceValidator(
  seed: number,
  topLevel = true,
  addressBearing = topLevel,
) {
  const byte = seed.toString(16).padStart(2, "0");
  const script = byte.repeat(seed + 1);
  const validator = { type: "PlutusV3", script } as const;
  return {
    ...(topLevel
      ? {
        title: `validator-${seed}`,
        address: addressBearing ? validatorToAddress("Preview", validator) : "",
      }
      : {}),
    script,
    scriptHash: validatorToScriptHash(validator),
    refUtxo: { txHash: byte.repeat(32), outputIndex: seed },
  };
}

function schemaV6Deployment() {
  const validators: Record<string, unknown> = {};
  REQUIRED_REFERENCE_VALIDATORS.forEach((name, index) => {
    validators[name] = referenceValidator(
      index + 1,
      true,
      ADDRESS_BEARING_REFERENCE_VALIDATORS.has(name),
    );
  });
  (validators.spendChannel as Record<string, unknown>).refValidator = Object
    .fromEntries(
      REQUIRED_CHANNEL_REFERENCE_VALIDATORS.map((name, index) => [
        name,
        referenceValidator(
          REQUIRED_REFERENCE_VALIDATORS.length + index + 1,
          false,
        ),
      ]),
    );
  validators.voucherMetadata = { address: "addr_test1_voucher_metadata" };

  const allReferenceBindings = [
    ...REQUIRED_REFERENCE_VALIDATORS.map((name) => {
      const validator = validators[name] as {
        scriptHash: string;
        refUtxo: { txHash: string; outputIndex: number };
      };
      return { ...validator.refUtxo, scriptHash: validator.scriptHash };
    }),
    ...Object.values(
      (validators.spendChannel as {
        refValidator: Record<
          string,
          {
            scriptHash: string;
            refUtxo: { txHash: string; outputIndex: number };
          }
        >;
      }).refValidator,
    ).map(({ refUtxo, scriptHash }) => ({ ...refUtxo, scriptHash })),
  ];
  const uniqueBindings = [...new Map(
    allReferenceBindings.map((reference) => [
      `${reference.txHash}#${reference.outputIndex}`,
      reference,
    ]),
  ).values()];
  const hostValidator = validators.hostStateStt as {
    scriptHash: string;
    refUtxo: { txHash: string; outputIndex: number };
  };
  const hostKey =
    `${hostValidator.refUtxo.txHash}#${hostValidator.refUtxo.outputIndex}`;
  const hostBinding = uniqueBindings.find((reference) =>
    `${reference.txHash}#${reference.outputIndex}` === hostKey
  )!;
  const orderedBindings = [
    hostBinding,
    ...uniqueBindings.filter((reference) =>
      `${reference.txHash}#${reference.outputIndex}` !== hostKey
    ).sort(compareReferenceScriptInventoryEntries),
  ];
  let referenceScriptInventoryRoot = EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT;
  const referenceOutRefs = orderedBindings.map((reference, index) => {
    const predecessorRoot = referenceScriptInventoryRoot;
    referenceScriptInventoryRoot = foldReferenceScriptInventory(
      [reference],
      predecessorRoot,
    );
    return {
      ...reference,
      predecessorRoot,
      resultingRoot: referenceScriptInventoryRoot,
      registrationBatchIndex: Math.floor(index / 10),
    };
  });

  return {
    schemaVersion: 6,
    deployedAt: "2026-08-22T12:00:00.000Z",
    referenceOutRefs,
    referenceScriptInventoryRoot,
    referenceValidator: {
      script: TEST_SCRIPT,
      scriptHash: TEST_SCRIPT_HASH,
      address: validatorToAddress("Preview", {
        type: "PlutusV3",
        script: TEST_SCRIPT,
      }),
    },
    hostStateNFT: {
      policyId: TEST_SCRIPT_HASH,
      name: "6962635f686f73745f7374617465",
      script: TEST_SCRIPT,
    },
    validators,
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

  const missingReferenceValidator = structuredClone(deployment) as Record<
    string,
    unknown
  >;
  delete missingReferenceValidator.referenceValidator;
  assertThrows(
    () => parseDeployment(missingReferenceValidator),
    Error,
    "referenceValidator artifact",
  );
  const tamperedReferenceValidator = structuredClone(deployment);
  tamperedReferenceValidator.referenceValidator.scriptHash = "ff".repeat(28);
  assertThrows(
    () => parseDeployment(tamperedReferenceValidator),
    Error,
    "does not match its script",
  );
  const mismatchedReferenceValidatorAddress = structuredClone(deployment);
  mismatchedReferenceValidatorAddress.referenceValidator.address =
    (deployment.validators.spendClient as { address: string }).address;
  assertThrows(
    () => parseDeployment(mismatchedReferenceValidatorAddress),
    Error,
    "referenceValidator.address does not match its script hash",
  );

  const mismatchedValidator = structuredClone(deployment);
  (
    mismatchedValidator.validators.spendClient as Record<string, unknown>
  ).scriptHash = "ff".repeat(28);
  assertThrows(
    () => parseDeployment(mismatchedValidator),
    Error,
    "scriptHash does not match its script",
  );
  const mismatchedValidatorAddress = structuredClone(deployment);
  (
    mismatchedValidatorAddress.validators.spendClient as {
      address: string;
    }
  ).address = (
    deployment.validators.spendConnection as { address: string }
  ).address;
  assertThrows(
    () => parseDeployment(mismatchedValidatorAddress),
    Error,
    "validator spendClient.address does not match its script hash",
  );
});

for (const name of REQUIRED_REFERENCE_VALIDATORS) {
  Deno.test(`shutdown requires the ${name} reference`, () => {
    const missingValidator = structuredClone(schemaV6Deployment());
    delete (missingValidator.validators as Record<string, unknown>)[name];
    assertThrows(
      () => parseDeployment(missingValidator),
      Error,
      `schema-v6 validator ${name}`,
    );
  });
}

Deno.test("shutdown rejects the formerly accepted sparse handler", () => {
  const sparse = schemaV6Deployment();
  sparse.validators = {
    hostStateStt: sparse.validators.hostStateStt,
    spendClient: sparse.validators.spendClient,
    spendTransferModule: sparse.validators.spendTransferModule,
    spendMockModule: sparse.validators.spendMockModule,
    mintLifecycleCreationMarker: sparse.validators.mintLifecycleCreationMarker,
    mintLifecycleReclamationMarker:
      sparse.validators.mintLifecycleReclamationMarker,
    mintLifecycleOperationalMarker:
      sparse.validators.mintLifecycleOperationalMarker,
    mintLifecyclePacketMarker: sparse.validators.mintLifecyclePacketMarker,
  };
  assertThrows(
    () => parseDeployment(sparse),
    Error,
    "schema-v6 validator spendConnection",
  );
});

for (const name of REQUIRED_CHANNEL_REFERENCE_VALIDATORS) {
  Deno.test(`shutdown requires the channel ${name} reference`, () => {
    const deployment = structuredClone(schemaV6Deployment());
    delete (
      deployment.validators.spendChannel as {
        refValidator: Record<string, unknown>;
      }
    ).refValidator[name];
    assertThrows(
      () => parseDeployment(deployment),
      Error,
      `channel reference validator ${name}`,
    );
  });
}

Deno.test("shutdown requires an exact reference-output inventory", () => {
  const missingInventory = structuredClone(schemaV6Deployment()) as Record<
    string,
    unknown
  >;
  delete missingInventory.referenceOutRefs;
  assertThrows(
    () => parseDeployment(missingInventory),
    Error,
    "complete referenceOutRefs inventory",
  );

  const omitted = structuredClone(schemaV6Deployment());
  omitted.referenceOutRefs.pop();
  omitted.referenceScriptInventoryRoot = omitted.referenceOutRefs.at(-1)!
    .resultingRoot;
  assertThrows(
    () => parseDeployment(omitted),
    Error,
    "does not exactly match validator references",
  );

  const unbound = structuredClone(schemaV6Deployment());
  const unboundIdentity = {
    txHash: "fe".repeat(32),
    outputIndex: 99,
    scriptHash: "ab".repeat(28),
  };
  const predecessorRoot = unbound.referenceScriptInventoryRoot;
  const resultingRoot = foldReferenceScriptInventory(
    [unboundIdentity],
    predecessorRoot,
  );
  unbound.referenceOutRefs.push({
    ...unboundIdentity,
    predecessorRoot,
    resultingRoot,
    registrationBatchIndex: unbound.referenceOutRefs.at(-1)!
      .registrationBatchIndex,
  });
  unbound.referenceScriptInventoryRoot = resultingRoot;
  assertThrows(
    () => parseDeployment(unbound),
    Error,
    "does not exactly match validator references",
  );

  const driftedRoot = structuredClone(schemaV6Deployment());
  driftedRoot.referenceScriptInventoryRoot = "ff".repeat(32);
  assertThrows(
    () => parseDeployment(driftedRoot),
    Error,
    "does not match the Host-first referenceOutRefs chain",
  );

  const hostNotFirst = structuredClone(schemaV6Deployment());
  [hostNotFirst.referenceOutRefs[0], hostNotFirst.referenceOutRefs[1]] = [
    hostNotFirst.referenceOutRefs[1],
    hostNotFirst.referenceOutRefs[0],
  ];
  assertThrows(
    () => parseDeployment(hostNotFirst),
    Error,
    "exact HostState STT reference first",
  );
});

Deno.test("shutdown requires a one-to-one script-hash and out-ref mapping", () => {
  const reusedReference = structuredClone(schemaV6Deployment());
  (
    reusedReference.validators.spendConnection as {
      refUtxo: { txHash: string; outputIndex: number };
    }
  ).refUtxo = (
    reusedReference.validators.spendClient as {
      refUtxo: { txHash: string; outputIndex: number };
    }
  ).refUtxo;
  assertThrows(
    () => parseDeployment(reusedReference),
    Error,
    "assigned to distinct script hashes",
  );

  const duplicatedScript = structuredClone(schemaV6Deployment());
  const spendClient = duplicatedScript.validators.spendClient as {
    script: string;
    scriptHash: string;
    address: string;
  };
  const spendConnection = duplicatedScript.validators.spendConnection as {
    script: string;
    scriptHash: string;
    address: string;
  };
  spendConnection.script = spendClient.script;
  spendConnection.scriptHash = spendClient.scriptHash;
  spendConnection.address = spendClient.address;
  assertThrows(
    () => parseDeployment(duplicatedScript),
    Error,
    "assigned to distinct reference outputs",
  );
});

Deno.test("shutdown tracks only the deployment's unique reference outputs", () => {
  const deployment = schemaV6Deployment();
  assertEquals(
    deploymentReferenceOutRefs(
      deployment as unknown as ReturnType<typeof parseDeployment>,
    ),
    deployment.referenceOutRefs,
  );
});

Deno.test("shutdown treats Ogmios, not Kupo history, as proof an out-ref is spent", () => {
  const reference = { txHash: "aa".repeat(32), outputIndex: 0 };
  const response = {
    result: [{
      transaction: { id: reference.txHash },
      index: reference.outputIndex,
    }],
  };
  const nodeLive = parseOgmiosLiveReferenceOutRefs(response, [reference]);
  assertEquals(nodeLive, [reference]);
  assertThrows(
    () =>
      reconcileReferenceUtxoViews(
        "addr_test1_reference",
        [reference],
        [],
        nodeLive,
      ),
    Error,
    "refusing to treat incomplete indexer history as proof they were spent",
  );
});

Deno.test("shutdown accepts reference visibility only when Kupo and Ogmios agree", () => {
  const reference = { txHash: "aa".repeat(32), outputIndex: 0 };
  const utxo = {
    ...reference,
    address: "addr_test1_reference",
    assets: { lovelace: 2_000_000n },
  };
  assertEquals(
    reconcileReferenceUtxoViews(
      utxo.address,
      [reference],
      [utxo],
      [reference],
    ),
    [utxo],
  );
  assertThrows(
    () =>
      reconcileReferenceUtxoViews(
        utxo.address,
        [reference],
        [utxo],
        [],
      ),
    Error,
    "wait for the providers to agree",
  );
});

Deno.test("shutdown error text redacts managed provider credentials", () => {
  assertEquals(
    redactManagedCredentials(
      "GET https://secret.kupo.example/path?api_key=another-secret",
      ["secret"],
    ),
    "GET https://[REDACTED].kupo.example/path?api_key=[REDACTED]",
  );
});

Deno.test("reference reclamation decrements the authenticated count and root suffix", () => {
  const deployment = parseDeployment(schemaV6Deployment());
  const inventory = deployment.referenceOutRefs;
  const finalEntry = inventory.at(-1)!;
  const datum = {
    state: {
      version: 8n,
      ibc_state_root: "aa".repeat(32),
      last_update_time: 500n,
    },
    shutdown: {
      Sealed: { sealed_at: 400n, proof_window_end: 450n },
    },
    live_reference_script_count: 5n,
    reference_script_inventory_root: inventory[4].resultingRoot,
    reference_script_registration: {
      target_count: BigInt(inventory.length),
      target_root: deployment.referenceScriptInventoryRoot,
      last_out_ref: {
        transaction_id: finalEntry.txHash,
        output_index: BigInt(finalEntry.outputIndex),
      },
    },
  } as unknown as Parameters<typeof buildReclaimedReferenceHostDatum>[0];
  const reclaimed = buildReclaimedReferenceHostDatum(
    datum,
    inventory.slice(3, 5),
    inventory[2].resultingRoot,
    501,
  );
  assertEquals(reclaimed.state.version, 9n);
  assertEquals(reclaimed.state.ibc_state_root, datum.state.ibc_state_root);
  assertEquals(reclaimed.state.last_update_time, 501n);
  assertEquals(reclaimed.shutdown, datum.shutdown);
  assertEquals(reclaimed.live_reference_script_count, 3n);
  assertEquals(
    reclaimed.reference_script_inventory_root,
    inventory[2].resultingRoot,
  );
  assertEquals(requireRegisteredReferenceCount(reclaimed), 3n);
  assertEquals(
    requireAuthenticatedReferenceInventory(deployment, reclaimed).liveCount,
    3,
  );
  assertThrows(
    () =>
      buildReclaimedReferenceHostDatum(
        reclaimed,
        inventory.slice(0, 4),
        EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT,
        502,
      ),
    Error,
    "Cannot reclaim",
  );
  assertThrows(
    () =>
      buildReclaimedReferenceHostDatum(
        datum,
        inventory.slice(0, 5),
        EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT,
        502,
      ),
    Error,
    "terminal HostState witness must remain",
  );
  assertThrows(
    () =>
      requireRegisteredReferenceCount({
        ...datum,
        live_reference_script_count: null,
      }),
    Error,
    "not registered",
  );
  assertThrows(
    () =>
      requireRegisteredReferenceCount({
        ...datum,
        live_reference_script_count: -5n,
      }),
    Error,
    "registration is incomplete",
  );
});

Deno.test("reference reclamation selects an authenticated suffix within both limits", () => {
  const deployment = parseDeployment(schemaV6Deployment());
  const inventory = deployment.referenceOutRefs.slice(0, 5);
  const scriptsByOutRef = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (
      typeof record.script === "string" &&
      typeof record.refUtxo === "object" && record.refUtxo !== null
    ) {
      const ref = record.refUtxo as { txHash: string; outputIndex: number };
      scriptsByOutRef.set(`${ref.txHash}#${ref.outputIndex}`, record.script);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(deployment.validators);
  const inventoryUtxos = inventory.map((entry) => ({
    txHash: entry.txHash,
    outputIndex: entry.outputIndex,
    address: "addr_test1_reference",
    assets: { lovelace: 2_000_000n },
    scriptRef: {
      type: "PlutusV3" as const,
      script: scriptsByOutRef.get(`${entry.txHash}#${entry.outputIndex}`)!,
    },
  }));
  const suffix = selectReferenceReclaimSuffix(
    inventory,
    inventoryUtxos,
    2,
  );
  assertEquals(suffix.entries, inventory.slice(3));
  assertEquals(suffix.predecessorRoot, inventory[2].resultingRoot);

  const lastScriptBytes = inventoryUtxos.at(-1)!.scriptRef.script.length / 2;
  const byteLimited = selectReferenceReclaimSuffix(
    inventory,
    inventoryUtxos,
    5,
    lastScriptBytes + 1,
  );
  assertEquals(byteLimited.entries, inventory.slice(-1));

  const hostWitnessReserve = 10;
  assertEquals(
    selectReferenceReclaimSuffix(
      inventory,
      inventoryUtxos,
      5,
      lastScriptBytes + hostWitnessReserve,
      hostWitnessReserve,
    ).entries,
    inventory.slice(-1),
  );
  assertThrows(
    () =>
      selectReferenceReclaimSuffix(
        inventory,
        inventoryUtxos,
        5,
        lastScriptBytes + hostWitnessReserve - 1,
        hostWitnessReserve,
      ),
    Error,
    "exceeding the",
  );

  const terminalSafe = selectReferenceReclaimSuffix(
    inventory,
    inventoryUtxos,
    5,
    1_000,
    0,
    1,
  );
  assertEquals(
    terminalSafe.entries,
    inventory.slice(1),
  );
  assertEquals(
    terminalSafe.predecessorRoot,
    inventory[0].resultingRoot,
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

  const timing = lifecycleTransitionTiming(1_000);
  assertEquals(timing, {
    validFrom: 1_000,
    validTo: 601_000,
    proofWindowEnd: 605_401_000,
  });

  const activeDatum = {
    state: { version: 7n, last_update_time: 500n },
    shutdown: "Active",
  } as unknown as Parameters<typeof buildShutdownEntryDatum>[0];
  const shuttingDown = buildShutdownEntryDatum(
    activeDatum,
    timing.validTo,
    900_000,
  );
  assertEquals(shuttingDown.state.version, 8n);
  assertEquals(shuttingDown.state.last_update_time, 601_000n);
  assertEquals(shuttingDown.shutdown, {
    ShuttingDown: {
      initiated_at: 601_000n,
      grace_period_end: 900_000n,
    },
  });

  const sealed = buildSealedHostDatum(
    shuttingDown,
    timing.validTo,
    timing.proofWindowEnd,
  );
  assertEquals(sealed.state.version, 9n);
  assertEquals(sealed.state.last_update_time, 601_000n);
  assertEquals(sealed.shutdown, {
    Sealed: {
      sealed_at: 601_000n,
      proof_window_end: 605_401_000n,
    },
  });
  assertThrows(
    () => lifecycleTransitionTiming(Number.MAX_SAFE_INTEGER),
    Error,
    "safe integers",
  );
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
