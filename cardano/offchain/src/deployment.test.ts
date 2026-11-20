import {
  DEPLOYMENT_PLAN_FIXTURE,
  loadDeploymentPlan,
} from "./deployment-plan.ts";
import { assertEquals, assertNotEquals } from "@std/assert";
import {
  Data,
  fromText,
  type LucidEvolution,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import blueprint from "../../onchain/plutus.json" with { type: "json" };
import { Buffer } from "node:buffer";
import collisionFixture from "../../../tests/ibc-state-commitment/collision-buckets.json" with {
  type: "json",
};
import {
  type BucketEntry,
  bucketHash,
  hash,
  keyHash,
  sortBucket,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/ibcStateCommitment.ts";

import {
  buildReferenceValidatorBatches,
  buildReferenceValidatorSizeReport,
  DeploymentIbcTree,
  GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  loadStagedTendermintValidators,
  selectDeploymentCollateralHoldback,
  sortPortRegistrations,
} from "./deployment.ts";
import { generatePortTokenName, readValidator } from "./utils.ts";

const makeValidator = (byteLength: number): Script => ({
  type: "PlutusV3",
  script: "ab".repeat(byteLength),
});

const EMPTY_HASH = "00".repeat(32);

Deno.test("deployment collateral preserves the large funding UTxO", () => {
  const utxo = (txHash: string, lovelace: bigint): UTxO =>
    ({
      txHash,
      outputIndex: 0,
      assets: { lovelace },
      address: "addr_test1collateral",
    }) as UTxO;
  const selected = selectDeploymentCollateralHoldback([
    utxo("large", 29_000_000_000n),
    utxo("collateral", 6_000_000n),
    utxo("small", 2_000_000n),
  ]);

  assertEquals(selected.map(({ txHash }) => txHash), ["collateral"]);
});

Deno.test("generatePortTokenName matches the cross-language transfer vector", () => {
  assertEquals(
    generatePortTokenName(fromText("transfer")),
    "04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
  );
});

Deno.test("generic module deployments pin the spend handler from the blueprint", () => {
  const genericModuleSpendHandler = blueprint.validators.find(
    ({ title }) => title === GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  ) as { title: string; parameters?: Array<{ title: string }> } | undefined;

  assertEquals(
    genericModuleSpendHandler?.title,
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  );
  assertEquals(
    genericModuleSpendHandler?.parameters?.map(({ title }) => title) ?? [],
    ["host_state_nft_policy_id"],
  );
});

Deno.test("every deployed channel operation is a mint-only policy", async () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const { spendingChannel: { referredScripts } } = await loadDeploymentPlan(
    lucid,
    {
      ...DEPLOYMENT_PLAN_FIXTURE,
      benchmarkVoucherEnabled: false,
    },
  );
  assertEquals(Object.keys(referredScripts).length, 12);
  for (const name of Object.keys(referredScripts)) {
    const prefix = `spending_channel/${name}.${name}`;
    assertEquals(
      blueprint.validators
        .map(({ title }) => title)
        .filter((title) => title.startsWith(prefix + "."))
        .sort(),
      [prefix + ".else", prefix + ".mint"],
    );
  }
});

Deno.test("chan_close_confirm is a mint-only policy in the compiled blueprint", () => {
  assertEquals(
    blueprint.validators
      .map(({ title }) => title)
      .filter((title) =>
        title.startsWith("spending_channel/chan_close_confirm.")
      )
      .sort(),
    [
      "spending_channel/chan_close_confirm.chan_close_confirm.else",
      "spending_channel/chan_close_confirm.chan_close_confirm.mint",
    ],
  );
});

Deno.test("HostState deployment pins the governed registry and control authority", () => {
  const validator = blueprint.validators.find(({ title }) =>
    title === "upgradeable/host_state.host_state.spend"
  );
  assertEquals(validator?.parameters?.map(({ title }) => title), [
    "registry_policy",
    "generation",
    "heartbeat_schedule",
    "shutdown_authority",
    "shutdown_host_policy",
  ]);
});

Deno.test("fully applied production governed HostState fits the reference publication guard", async () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const plan = await loadDeploymentPlan(lucid, {
    ...DEPLOYMENT_PLAN_FIXTURE,
    benchmarkVoucherEnabled: false,
  });
  const [report] = buildReferenceValidatorSizeReport(
    [plan.hostState.script],
    16_384 - 75,
  );
  // As with the staged client, the signed publication test is the ledger gate;
  // the conservative batching estimate can overstate a dedicated publication.
  assertEquals(
    report.intrinsicallyOversized,
    false,
    JSON.stringify(report),
  );
});

Deno.test("production transfer module requires dedicated funding and fits the script limit", async () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const plan = await loadDeploymentPlan(
    lucid,
    {
      ...DEPLOYMENT_PLAN_FIXTURE,
      benchmarkVoucherEnabled: false,
    },
  );
  const [report] = buildReferenceValidatorSizeReport(
    [plan.spendTransferModule.script],
    16_384,
  );
  assertEquals(
    report.exceedsEstimatedSingleTxBudget,
    true,
    JSON.stringify(report),
  );
  assertEquals(report.intrinsicallyOversized, false);
});

Deno.test("fully applied multitx client reserves 200 bytes for its signed publication", async () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const plan = await loadDeploymentPlan(lucid, {
    ...DEPLOYMENT_PLAN_FIXTURE,
    benchmarkVoucherEnabled: false,
  });
  // Check script bytes with room for transaction overhead. Conservative size
  // estimates are advisory; signed production publications are the ledger gate.
  // The transaction suite separately signs and submits the production builder's
  // reference publication to an emulator with the real 16,384-byte limit.
  const [report] = buildReferenceValidatorSizeReport(
    [plan.spendClient.script],
    16_384 - 200,
  );
  assertEquals(report.intrinsicallyOversized, false, JSON.stringify(report));
});

Deno.test("mock and icq share the host-policy-bound generic module hash", () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const parameterSchema = Data.Tuple([Data.Bytes()]) as unknown as [string];
  const hostPolicy = "11".repeat(28);
  const [, mockHash] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    [hostPolicy],
    parameterSchema,
  );
  const [, icqHash] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    [hostPolicy],
    parameterSchema,
  );
  const [, otherHostHash] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    ["22".repeat(28)],
    parameterSchema,
  );

  assertEquals(mockHash, icqHash);
  assertNotEquals(mockHash, otherHostHash);
});

Deno.test("staged Tendermint validators preserve their hash dependencies", () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const hostPolicy = "11".repeat(28);
  const recoveryScriptHash = "33".repeat(28);
  const staged = loadStagedTendermintValidators(
    lucid,
    hostPolicy,
    recoveryScriptHash,
    "ee".repeat(28),
  );

  const [, expectedSessionMintPolicyId] = readValidator(
    "minting_tendermint_update_session.mint_tendermint_update_session.mint",
    lucid,
    [staged.sessionSpend.scriptHash],
    Data.Tuple([Data.Bytes()]) as unknown as [string],
  );
  const [, expectedClientSpendScriptHash] = readValidator(
    "upgradeable/client.client.spend",
    lucid,
    ["ee".repeat(28), 1n, hostPolicy, staged.updateClient.scriptHash, {
      Script: [recoveryScriptHash],
    }],
    Data.Tuple([
      Data.Bytes(),
      Data.Integer(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Enum([
        Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
        Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
      ]),
    ]) as unknown as [string, bigint, string, string, { Script: [string] }],
  );

  assertEquals(staged.sessionMint.policyId, expectedSessionMintPolicyId);
  assertEquals(staged.clientSpend.scriptHash, expectedClientSpendScriptHash);

  const otherHost = loadStagedTendermintValidators(
    lucid,
    "22".repeat(28),
    recoveryScriptHash,
    "ee".repeat(28),
  );
  assertNotEquals(
    staged.sessionSpend.scriptHash,
    otherHost.sessionSpend.scriptHash,
  );
  assertNotEquals(staged.sessionMint.policyId, otherHost.sessionMint.policyId);
  assertNotEquals(
    staged.clientSpend.scriptHash,
    otherHost.clientSpend.scriptHash,
  );
  const otherRecovery = loadStagedTendermintValidators(
    lucid,
    hostPolicy,
    "44".repeat(28),
    "ee".repeat(28),
  );
  assertEquals(
    staged.sessionSpend.scriptHash,
    otherRecovery.sessionSpend.scriptHash,
  );
  assertEquals(staged.sessionMint.policyId, otherRecovery.sessionMint.policyId);
  assertNotEquals(
    staged.clientSpend.scriptHash,
    otherRecovery.clientSpend.scriptHash,
  );
  assertEquals(
    buildReferenceValidatorSizeReport(
      [
        staged.sessionSpend.validator,
        staged.sessionMint.validator,
        staged.clientSpend.validator,
      ],
      16_384,
    ).map(({ intrinsicallyOversized }) => intrinsicallyOversized),
    [false, false, false],
  );
});

Deno.test("sortPortRegistrations uses canonical bytes-key ordering", () => {
  const registration = {
    module_script_hash: "00".repeat(28),
    port_token: { policy_id: "11".repeat(28), name: "22" },
    module_token: { policy_id: "33".repeat(28), name: "44" },
  };
  const registrations = new Map([
    [fromText("transfer"), registration],
    [fromText("icqhost"), registration],
    [fromText("mock"), registration],
  ]);

  assertEquals(
    [...sortPortRegistrations(registrations).keys()],
    [fromText("mock"), fromText("icqhost"), fromText("transfer")],
  );
});

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes as unknown as BufferSource,
      ),
    ),
  );

const expectedSingleLeafRoot = async (
  key: string,
  valueHex: string,
): Promise<string> => {
  const keyHash = await sha256Hex(new TextEncoder().encode(key));
  const valueHash = await sha256Hex(hexToBytes(valueHex));
  let current = await sha256Hex(
    concatBytes(
      new Uint8Array([0]),
      hexToBytes(keyHash),
      hexToBytes(valueHash),
    ),
  );
  let index = BigInt(`0x${keyHash.slice(0, 16)}`);

  for (let depth = 0; depth < 64; depth += 1) {
    const currentBytes = hexToBytes(current);
    current = (index & 1n) === 0n
      ? await sha256Hex(
        concatBytes(new Uint8Array([1]), currentBytes, hexToBytes(EMPTY_HASH)),
      )
      : await sha256Hex(
        concatBytes(new Uint8Array([1]), hexToBytes(EMPTY_HASH), currentBytes),
      );
    index >>= 1n;
  }

  return current;
};

Deno.test("buildReferenceValidatorBatches groups validators within the tx budget", () => {
  const validators = [
    makeValidator(100),
    makeValidator(100),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 5_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 2]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [2, 1],
  );
});

Deno.test("buildReferenceValidatorBatches keeps an oversized validator in its own batch", () => {
  const validators = [
    makeValidator(900),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 5_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 1]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [1, 1],
  );
});

Deno.test("buildReferenceValidatorSizeReport allows single validators that exceed the batch budget", () => {
  const validators = [
    makeValidator(1_200),
    makeValidator(100),
  ];

  const report = buildReferenceValidatorSizeReport(validators, 5_600);

  assertEquals(report[0].index, 0);
  assertEquals(report[0].scriptBytes, 1_200);
  assertEquals(report[0].estimatedReferenceOutputBytes, 1_400);
  assertEquals(report[0].exceedsEstimatedSingleTxBudget, false);
  assertEquals(report[1].exceedsEstimatedSingleTxBudget, false);
});

Deno.test("buildReferenceValidatorSizeReport flags validators that cannot fit alone", () => {
  const validators = [
    makeValidator(5_000),
    makeValidator(100),
  ];

  const report = buildReferenceValidatorSizeReport(validators, 5_600);

  assertEquals(report[0].index, 0);
  assertEquals(report[0].scriptBytes, 5_000);
  assertEquals(report[0].estimatedReferenceOutputBytes, 5_200);
  assertEquals(report[0].exceedsEstimatedSingleTxBudget, true);
  assertEquals(report[1].exceedsEstimatedSingleTxBudget, false);
});

Deno.test("DeploymentIbcTree commits leaves with key hash included", async () => {
  const tree = new DeploymentIbcTree();
  const key = "ports/transfer";
  const value = Data.to(100n as never, Data.Integer() as never, {
    canonical: true,
  });

  tree.set(key, value);

  assertEquals(await tree.getRoot(), await expectedSingleLeafRoot(key, value));
});

Deno.test("collateral holdback keeps the main deployment funding output spendable", () => {
  const utxos = [99_176_454_853n, 5_158_925n, 5_936_517n, 2_358_421n].map((
    lovelace,
    outputIndex,
  ) => ({
    txHash: "11".repeat(32),
    outputIndex,
    address: "test",
    assets: { lovelace },
  } as UTxO));
  assertEquals(selectDeploymentCollateralHoldback(utxos), [utxos[1]]);
});

Deno.test("deployment collision witnesses and incremental removal preserve the other key", async () => {
  const populated = collisionFixture.vectors.find((v) =>
    v.name === "insert_collision"
  )!;
  const missing = collisionFixture.vectors.find((v) =>
    v.name === "missing_in_singleton"
  )!;
  const tree = new DeploymentIbcTree();
  tree.set("ports/transfer", "d8799f01ff");
  tree.set(populated.key, populated.committed);
  await tree.getRoot();

  // Simulate a peer digest sharing the route. All hashing and the requested
  // key remain native, as in the Gateway/Go/Aiken collision vectors.
  const digest = keyHash(populated.key);
  const index = digest.readBigUInt64BE();
  const cache = tree as unknown as {
    leaves: Map<string, string>;
    buckets: Map<bigint, BucketEntry[]>;
    nodesByHeight: Array<Map<bigint, string>>;
    root: string;
  };
  cache.leaves.set("synthetic-collision-peer-0", "aabb");
  const entries = sortBucket([
    {
      keyHash: digest,
      valueHash: hash(Buffer.from(populated.committed, "hex")),
    },
    {
      keyHash: Buffer.from(collisionFixture.syntheticPeerDigests[0], "hex"),
      valueHash: hash(Buffer.from("aabb", "hex")),
    },
  ]);
  cache.buckets.set(index, entries);
  cache.nodesByHeight[0].set(index, bucketHash(entries).toString("hex"));
  cache.root = populated.root;
  assertEquals(await tree.getSiblings(populated.key), populated.siblings);
  await tree.remove(populated.key);
  assertEquals(await tree.getRoot(), missing.root);
  assertEquals(await tree.getSiblings(populated.key), missing.siblings);
});

Deno.test("blueprint exposes no immutable deployment entry points", () => {
  const removed = new Set([
    "host_state_stt",
    "spending_client",
    "recover_client",
    "spending_multitx_client",
    "spending_cached_client",
    "spending_validator_cache",
    "minting_cached_client",
    "minting_client_stt",
    "minting_connection_stt",
    "minting_channel_stt",
    "spending_connection",
    "spending_transfer_module",
    "spending_channel",
  ]);
  assertEquals(
    blueprint.validators.filter(({ title }) => removed.has(title.split(".")[0]))
      .map(({ title }) => title),
    [],
  );
});
