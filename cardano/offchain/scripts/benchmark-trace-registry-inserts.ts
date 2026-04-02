import {
  applyParamsToScript,
  Constr,
  credentialToAddress,
  Data,
  fromHex,
  fromText,
  Kupmios,
  Lucid,
  LucidEvolution,
  Network,
  SLOT_CONFIG_NETWORK,
  type TxBuilder,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  generateIdentifierTokenName,
  hashSha3_256,
  querySystemStart,
  submitTx,
} from "../src/utils.ts";
import { AuthTokenSchema, OutputReference } from "../types/index.ts";

const TRACE_REGISTRY_TX_SIZE_HEADROOM_BYTES = 1024;
const BENCHMARK_VOUCHER_AMOUNT = 1n;
const BENCHMARK_SINK_LOVELACE = 2_000_000n;
const BENCHMARK_SINK_PAYMENT_KEY_HASH = "11".repeat(28);

type ScriptArgs = {
  bucket: number;
  inserts: number;
  json: boolean;
};

type RefUtxo = {
  txHash: string;
  outputIndex: number;
};

type DeploymentInfo = {
  validators: {
    mintVoucher: {
      scriptHash: string;
    };
    spendTraceRegistry: {
      script: string;
      scriptHash: string;
      refUtxo: RefUtxo;
    };
    mintIdentifier: {
      script: string;
      scriptHash: string;
      refUtxo: RefUtxo;
    };
    mintTraceRegistryBenchmarkVoucher?: {
      script: string;
      scriptHash: string;
      refUtxo: RefUtxo;
    };
  };
  traceRegistry?: {
    address: string;
    shardPolicyId: string;
    directory: {
      policyId: string;
      name: string;
    };
  };
};

type PlutusBlueprint = {
  validators?: Array<{
    title?: string;
    hash?: string;
    compiledCode?: string;
  }>;
};

type RuntimeTraceRegistryEntry = {
  voucherHash: string;
  fullDenom: string;
};

type RuntimeTraceRegistryShardDatum = {
  bucketIndex: bigint;
  entries: RuntimeTraceRegistryEntry[];
};

type RuntimeTraceRegistryDirectoryBucket = {
  bucketIndex: bigint;
  activeShardName: string;
  archivedShardNames: string[];
};

type RuntimeTraceRegistryDirectoryDatum = {
  buckets: RuntimeTraceRegistryDirectoryBucket[];
};

type TraceRegistryDatum =
  | { Shard: RuntimeTraceRegistryShardDatum }
  | { Directory: RuntimeTraceRegistryDirectoryDatum };

type TraceRegistryRedeemer =
  | {
    InsertTrace: {
      voucher_hash: string;
      full_denom: string;
    };
  }
  | {
    RolloverInsertTrace: {
      voucher_hash: string;
      full_denom: string;
      new_active_shard_name: string;
    };
  }
  | {
    AdvanceDirectory: {
      bucket_index: bigint;
      voucher_hash: string;
      full_denom: string;
      previous_active_shard_name: string;
      new_active_shard_name: string;
    };
  };

type TraceRegistryConfig = NonNullable<DeploymentInfo["traceRegistry"]>;

type TraceRegistryAppendInsertContext = {
  kind: "append";
  directoryUtxo: UTxO;
  shardUtxo: UTxO;
  encodedTraceRegistryRedeemer: string;
  encodedUpdatedTraceRegistryDatum: string;
};

type TraceRegistryRolloverInsertContext = {
  kind: "rollover";
  directoryUtxo: UTxO;
  shardUtxo: UTxO;
  nonceUtxo: UTxO;
  encodedTraceRegistryDirectoryRedeemer: string;
  encodedUpdatedTraceRegistryDirectoryDatum: string;
  encodedTraceRegistryRedeemer: string;
  encodedArchivedTraceRegistryDatum: string;
  encodedNewActiveTraceRegistryDatum: string;
  newActiveTraceRegistryShardTokenUnit: string;
  encodedMintIdentifierRedeemer: string;
};

type PreparedInsertContexts = {
  append: TraceRegistryAppendInsertContext;
  rollover: TraceRegistryRolloverInsertContext;
};

type BenchmarkReferenceScripts = {
  spendTraceRegistryValidator: { type: "PlutusV3"; script: string };
  mintIdentifierPolicy: { type: "PlutusV3"; script: string };
  mintTraceRegistryBenchmarkVoucherPolicy: {
    type: "PlutusV3";
    script: string;
  };
};

type BenchmarkInsertResult = {
  insertIndex: number;
  voucherHash: string;
  fullDenom: string;
  bucket: number;
  txHash: string;
  rollover: boolean;
};

function usage(): string {
  return ("Usage: deno run --env-file=.env.default --allow-net --allow-env --allow-read --allow-ffi scripts/benchmark-trace-registry-inserts.ts --bucket <0-15> [--inserts <count>] [--json]");
}

function parseArgs(argv: string[]): ScriptArgs {
  let bucket: number | undefined;
  let inserts = 1;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--bucket": {
        const raw = argv[index + 1];
        if (!raw) {
          throw new Error(usage());
        }
        bucket = Number(raw);
        index += 1;
        break;
      }
      case "--inserts": {
        const raw = argv[index + 1];
        if (!raw) {
          throw new Error(usage());
        }
        inserts = Number(raw);
        index += 1;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        Deno.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    bucket === undefined || !Number.isInteger(bucket) || bucket < 0 ||
    bucket > 15
  ) {
    throw new Error(
      `${usage()}\n--bucket must be an integer between 0 and 15, received ${
        String(bucket)
      }`,
    );
  }
  if (!Number.isInteger(inserts) || inserts < 1) {
    throw new Error(
      `${usage()}\n--inserts must be an integer >= 1, received ${
        String(inserts)
      }`,
    );
  }

  return {
    bucket,
    inserts,
    json,
  };
}

function parseNetwork(networkMagic: string): Network {
  switch (networkMagic) {
    case "1":
      return "Preprod";
    case "2":
      return "Preview";
    case "764824073":
      return "Mainnet";
    default:
      return "Custom";
  }
}

async function buildLucid(): Promise<LucidEvolution> {
  const deployerSk = Deno.env.get("DEPLOYER_SK");
  const kupoUrl = Deno.env.get("KUPO_URL");
  const ogmiosUrl = Deno.env.get("OGMIOS_URL");
  const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

  if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
    throw new Error("Missing required Cardano offchain environment variables");
  }

  const provider = new Kupmios(kupoUrl, ogmiosUrl);
  const originalEvaluateTx = (provider as any).evaluateTx?.bind(provider);
  if (typeof originalEvaluateTx === "function") {
    (provider as any).evaluateTx = async (tx: string, additionalUTxOs?: any[]) => {
      try {
        return await originalEvaluateTx(tx, additionalUTxOs);
      } catch (error) {
        const dumpId = Date.now();
        const dumpTxPath = `/tmp/trace-registry-benchmark-evaluateTx-${dumpId}.tx`;
        const dumpContextPath =
          `/tmp/trace-registry-benchmark-evaluateTx-${dumpId}.context.json`;

        try {
          Deno.writeTextFileSync(dumpTxPath, tx);
          Deno.writeTextFileSync(
            dumpContextPath,
            JSON.stringify(
              {
                additionalUTxOs: additionalUTxOs ?? [],
              },
              (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
              2,
            ),
          );
          console.error(
            `[DEBUG] benchmark evaluateTx dumped failing tx to ${dumpTxPath}`,
          );
          console.error(
            `[DEBUG] benchmark evaluateTx dumped failure context to ${dumpContextPath}`,
          );
        } catch (dumpError) {
          console.error(
            "[DEBUG] benchmark evaluateTx failed to dump tx/context:",
            dumpError,
          );
        }

        console.error("[DEBUG] benchmark evaluateTx failed:", error);
        throw error;
      }
    };
  }
  const chainZeroTime = await querySystemStart(ogmiosUrl);
  SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
  const protocolParameters = await provider.getProtocolParameters();
  const lucid = await Lucid(
    provider,
    parseNetwork(cardanoNetworkMagic),
    {
      presetProtocolParameters: protocolParameters,
    } as any,
  );

  lucid.selectWallet.fromPrivateKey(deployerSk);
  return lucid;
}

function loadDeploymentInfo(): DeploymentInfo {
  const handlerJsonPath = Deno.env.get("HANDLER_JSON_PATH") ??
    "./deployments/handler.json";
  return JSON.parse(Deno.readTextFileSync(handlerJsonPath)) as DeploymentInfo;
}

function loadCurrentBlueprintValidators(): Record<
  string,
  { hash?: string; compiledCode?: string }
> {
  const plutusJsonUrl = new URL("../../onchain/plutus.json", import.meta.url);
  const blueprint = JSON.parse(
    Deno.readTextFileSync(plutusJsonUrl),
  ) as PlutusBlueprint;

  return Object.fromEntries(
    (blueprint.validators ?? [])
      .filter((validator) => validator.title)
      .map((validator) => [
        validator.title!,
        {
          hash: validator.hash?.toLowerCase(),
          compiledCode: validator.compiledCode,
        },
      ]),
  );
}

function assertBenchmarkDeploymentMatchesCurrentValidators(
  deployment: DeploymentInfo,
) {
  const currentBlueprintValidators = loadCurrentBlueprintValidators();
  const traceRegistryBlueprint = currentBlueprintValidators[
    "trace_registry.spend_trace_registry.spend"
  ];
  const benchmarkVoucherBlueprint = currentBlueprintValidators[
    "minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint"
  ];
  const expectedBenchmarkVoucherHash = benchmarkVoucherBlueprint?.hash;

  let expectedSpendTraceRegistryHash: string | undefined = undefined;
  if (traceRegistryBlueprint?.compiledCode) {
    // spendTraceRegistry is parameterized at deployment time, so comparing against the
    // raw blueprint hash produces a false "stale handler" result even after a fresh
    // local redeploy. Recompute the current-branch script hash with the same runtime
    // parameters the deployer uses for this local deployment.
    const benchmarkVoucherPolicyId = deployment.validators
      .mintTraceRegistryBenchmarkVoucher?.scriptHash ?? "";
    const directoryAuthToken = deployment.traceRegistry
      ? {
        policy_id: deployment.traceRegistry.directory.policyId,
        name: deployment.traceRegistry.directory.name,
      }
      : {
        policy_id: "",
        name: "",
      };
    const parameterizedTraceRegistryScript = {
      type: "PlutusV3" as const,
      script: applyParamsToScript(
        traceRegistryBlueprint.compiledCode,
        [
          deployment.validators.mintIdentifier.scriptHash,
          directoryAuthToken,
          deployment.validators.mintVoucher.scriptHash,
          benchmarkVoucherPolicyId,
        ],
        Data.Tuple([
          Data.Bytes(),
          AuthTokenSchema,
          Data.Bytes(),
          Data.Bytes(),
        ]) as unknown as [
          string,
          { policy_id: string; name: string },
          string,
          string,
        ],
      ),
    };
    expectedSpendTraceRegistryHash = validatorToScriptHash(
      parameterizedTraceRegistryScript,
    ).toLowerCase();
  }

  const deployedSpendTraceRegistryHash = deployment.validators
    .spendTraceRegistry.scriptHash.toLowerCase();
  const deployedBenchmarkVoucherHash = deployment.validators
    .mintTraceRegistryBenchmarkVoucher?.scriptHash?.toLowerCase();

  if (
    expectedSpendTraceRegistryHash &&
    deployedSpendTraceRegistryHash !== expectedSpendTraceRegistryHash
  ) {
    throw new Error(
      "Local handler.json is stale for spendTraceRegistry: deployed hash " +
        `${deployedSpendTraceRegistryHash} does not match current branch hash ` +
        `${expectedSpendTraceRegistryHash}. Delete cardano/offchain/deployments ` +
        "and redeploy the local bridge on feat/cardano-onchain-trace-registry.",
    );
  }

  if (
    expectedBenchmarkVoucherHash &&
    deployedBenchmarkVoucherHash !== expectedBenchmarkVoucherHash
  ) {
    throw new Error(
      "Local handler.json is stale for mintTraceRegistryBenchmarkVoucher: " +
        `deployed hash ${
          String(deployedBenchmarkVoucherHash)
        } does not match ` +
        `current branch hash ${expectedBenchmarkVoucherHash}. Delete ` +
        "cardano/offchain/deployments and redeploy the local bridge on " +
        "feat/cardano-onchain-trace-registry.",
    );
  }
}

function getTraceRegistryConfig(
  deployment: DeploymentInfo,
): TraceRegistryConfig {
  if (
    !deployment.traceRegistry?.address || !deployment.traceRegistry.directory
  ) {
    throw new Error("Trace registry is not configured in handler.json");
  }

  return deployment.traceRegistry;
}

function benchmarkVoucherPolicyId(deployment: DeploymentInfo): string {
  const policyId = deployment.validators.mintTraceRegistryBenchmarkVoucher
    ?.scriptHash;
  if (!policyId) {
    throw new Error(
      "Local benchmark voucher policy is missing from handler.json. Re-run the bridge deployment on feat/cardano-onchain-trace-registry first.",
    );
  }
  return policyId;
}

function decodeHexToText(hex: string): string {
  return new TextDecoder().decode(fromHex(hex));
}

function expectConstr(
  value: unknown,
  expectedIndex?: number,
): { index: number; fields: unknown[] } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("index" in value) ||
    !("fields" in value)
  ) {
    throw new Error("Expected trace-registry constructor data");
  }

  const constr = value as { index: number; fields: unknown[] };
  if (expectedIndex !== undefined && constr.index !== expectedIndex) {
    throw new Error(
      `Unexpected trace-registry constructor index ${constr.index}, expected ${expectedIndex}`,
    );
  }

  return constr;
}

function encodeEntry(entry: RuntimeTraceRegistryEntry) {
  return new Constr(0, [entry.voucherHash, fromText(entry.fullDenom)]);
}

function decodeEntry(value: unknown): RuntimeTraceRegistryEntry {
  const constr = expectConstr(value, 0);
  const [voucherHash, fullDenom] = constr.fields;
  if (typeof voucherHash !== "string" || typeof fullDenom !== "string") {
    throw new Error("Invalid trace-registry entry fields");
  }

  return {
    voucherHash: voucherHash.toLowerCase(),
    fullDenom: decodeHexToText(fullDenom),
  };
}

function encodeShardDatum(datum: RuntimeTraceRegistryShardDatum) {
  return new Constr(0, [
    datum.bucketIndex,
    datum.entries.map((entry) => encodeEntry(entry)),
  ]);
}

function decodeShardDatum(value: unknown): RuntimeTraceRegistryShardDatum {
  const constr = expectConstr(value, 0);
  const [bucketIndex, entries] = constr.fields;
  if (typeof bucketIndex !== "bigint" || !Array.isArray(entries)) {
    throw new Error("Invalid trace-registry shard datum fields");
  }

  return {
    bucketIndex,
    entries: entries.map((entry) => decodeEntry(entry)),
  };
}

function encodeDirectoryBucket(
  bucket: RuntimeTraceRegistryDirectoryBucket,
) {
  return new Constr(0, [
    bucket.bucketIndex,
    bucket.activeShardName,
    bucket.archivedShardNames,
  ]);
}

function decodeDirectoryBucket(
  value: unknown,
): RuntimeTraceRegistryDirectoryBucket {
  const constr = expectConstr(value, 0);
  const [bucketIndex, activeShardName, archivedShardNames] = constr.fields;
  if (
    typeof bucketIndex !== "bigint" ||
    typeof activeShardName !== "string" ||
    !Array.isArray(archivedShardNames) ||
    !archivedShardNames.every((name) => typeof name === "string")
  ) {
    throw new Error("Invalid trace-registry directory bucket fields");
  }

  return {
    bucketIndex,
    activeShardName,
    archivedShardNames,
  };
}

function encodeDirectoryDatum(
  datum: RuntimeTraceRegistryDirectoryDatum,
) {
  return new Constr(0, [
    datum.buckets.map((bucket) => encodeDirectoryBucket(bucket)),
  ]);
}

function decodeDirectoryDatum(
  value: unknown,
): RuntimeTraceRegistryDirectoryDatum {
  const constr = expectConstr(value, 0);
  const [buckets] = constr.fields;
  if (!Array.isArray(buckets)) {
    throw new Error("Invalid trace-registry directory datum buckets");
  }

  return {
    buckets: buckets.map((bucket) => decodeDirectoryBucket(bucket)),
  };
}

function encodeTraceRegistryDatum(
  datum: RuntimeTraceRegistryShardDatum | RuntimeTraceRegistryDirectoryDatum,
  kind: "Shard" | "Directory",
): string {
  if (kind === "Shard") {
    const shard = datum as RuntimeTraceRegistryShardDatum;
    return Data.to(
      new Constr(0, [encodeShardDatum(shard)]) as any,
      undefined,
      { canonical: true },
    );
  }

  const directory = datum as RuntimeTraceRegistryDirectoryDatum;
  return Data.to(
    new Constr(1, [encodeDirectoryDatum(directory)]) as any,
    undefined,
    { canonical: true },
  );
}

function decodeTraceRegistryDirectoryDatum(
  encodedDatum: string,
): RuntimeTraceRegistryDirectoryDatum {
  const decoded = Data.from(encodedDatum);
  const outer = expectConstr(decoded);
  if (outer.index !== 1) {
    throw new Error(
      "Trace-registry directory UTxO does not contain a directory datum",
    );
  }

  return decodeDirectoryDatum(outer.fields[0]);
}

function decodeTraceRegistryShardDatum(
  encodedDatum: string,
  expectedBucketIndex: number,
): RuntimeTraceRegistryShardDatum {
  const decoded = Data.from(encodedDatum);
  const outer = expectConstr(decoded);
  if (outer.index !== 0) {
    throw new Error("Trace-registry shard UTxO does not contain a shard datum");
  }
  const shard = decodeShardDatum(outer.fields[0]);
  if (Number(shard.bucketIndex) !== expectedBucketIndex) {
    throw new Error(
      `Trace-registry shard datum mismatch: expected bucket ${expectedBucketIndex}, found ${shard.bucketIndex.toString()}`,
    );
  }

  return shard;
}

function encodeTraceRegistryRedeemer(redeemer: TraceRegistryRedeemer): string {
  if ("InsertTrace" in redeemer) {
    return Data.to(
      new Constr(0, [
        redeemer.InsertTrace.voucher_hash,
        fromText(redeemer.InsertTrace.full_denom),
      ]) as any,
      undefined,
      { canonical: true },
    );
  }

  if ("RolloverInsertTrace" in redeemer) {
    return Data.to(
      new Constr(1, [
        redeemer.RolloverInsertTrace.voucher_hash,
        fromText(redeemer.RolloverInsertTrace.full_denom),
        redeemer.RolloverInsertTrace.new_active_shard_name,
      ]) as any,
      undefined,
      { canonical: true },
    );
  }

  return Data.to(
    new Constr(2, [
      redeemer.AdvanceDirectory.bucket_index,
      redeemer.AdvanceDirectory.voucher_hash,
      fromText(redeemer.AdvanceDirectory.full_denom),
      redeemer.AdvanceDirectory.previous_active_shard_name,
      redeemer.AdvanceDirectory.new_active_shard_name,
    ]) as any,
    undefined,
    { canonical: true },
  );
}

function bucketIndexForHash(voucherHash: string): number {
  if (!/^[0-9a-f]{64}$/i.test(voucherHash)) {
    throw new Error(`Invalid voucher hash ${voucherHash}`);
  }
  return Number.parseInt(voucherHash[0], 16);
}

async function computeVoucherHash(fullDenom: string): Promise<string> {
  return (await hashSha3_256(fromText(fullDenom))).toLowerCase();
}

function benchmarkSinkAddress(lucid: LucidEvolution): string {
  return credentialToAddress(lucid.config().network || "Custom", {
    type: "Key",
    hash: BENCHMARK_SINK_PAYMENT_KEY_HASH,
  });
}

async function resolveOutRefUtxo(
  lucid: LucidEvolution,
  outRef: RefUtxo,
): Promise<UTxO> {
  const maxAttempts = 10;
  const retryDelayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const utxos = await lucid.utxosByOutRef([
      {
        txHash: outRef.txHash,
        outputIndex: outRef.outputIndex,
      },
    ]);
    if (utxos.length > 0) {
      return utxos[0];
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Unable to resolve live reference UTxO ${outRef.txHash}#${outRef.outputIndex}`,
  );
}

async function findUtxoByUnit(
  lucid: LucidEvolution,
  unit: string,
): Promise<UTxO> {
  const maxAttempts = 10;
  const retryDelayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const utxo = await lucid.utxoByUnit(unit);
    if (utxo) {
      const live = await lucid.utxosByOutRef([
        {
          txHash: utxo.txHash,
          outputIndex: utxo.outputIndex,
        },
      ]);
      if (live.length > 0) {
        return live[0];
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Unable to find live UTxO with unit ${unit}`);
}

async function loadBenchmarkReferenceScripts(
  lucid: LucidEvolution,
  deployment: DeploymentInfo,
): Promise<BenchmarkReferenceScripts> {
  const benchmarkPolicy = deployment.validators.mintTraceRegistryBenchmarkVoucher;
  if (!benchmarkPolicy?.script) {
    throw new Error(
      "Local benchmark voucher policy script is missing from handler.json. Re-run the bridge deployment on feat/cardano-onchain-trace-registry first.",
    );
  }
  if (!deployment.validators.spendTraceRegistry.script) {
    throw new Error(
      "Trace-registry spending validator script is missing from handler.json",
    );
  }
  if (!deployment.validators.mintIdentifier.script) {
    throw new Error(
      "Identifier minting policy script is missing from handler.json",
    );
  }

  return {
    spendTraceRegistryValidator: {
      type: "PlutusV3",
      script: deployment.validators.spendTraceRegistry.script,
    },
    mintIdentifierPolicy: {
      type: "PlutusV3",
      script: deployment.validators.mintIdentifier.script,
    },
    mintTraceRegistryBenchmarkVoucherPolicy: {
      type: "PlutusV3",
      script: benchmarkPolicy.script,
    },
  };
}

async function loadDirectoryDatum(
  lucid: LucidEvolution,
  registry: TraceRegistryConfig,
): Promise<{ utxo: UTxO; datum: RuntimeTraceRegistryDirectoryDatum }> {
  const directoryUnit = registry.directory.policyId + registry.directory.name;
  const utxo = await findUtxoByUnit(lucid, directoryUnit);
  if (!utxo.datum) {
    throw new Error("Trace-registry directory UTxO is missing inline datum");
  }

  return {
    utxo,
    datum: decodeTraceRegistryDirectoryDatum(utxo.datum),
  };
}

function getDirectoryBucket(
  directory: RuntimeTraceRegistryDirectoryDatum,
  bucketIndex: number,
): RuntimeTraceRegistryDirectoryBucket {
  const bucket = directory.buckets.find((candidate) =>
    Number(candidate.bucketIndex) === bucketIndex
  );
  if (!bucket) {
    throw new Error(`Missing trace-registry bucket ${bucketIndex}`);
  }
  return bucket;
}

async function loadShardDatumByUnit(
  lucid: LucidEvolution,
  unit: string,
  expectedBucketIndex: number,
): Promise<{ utxo: UTxO; datum: RuntimeTraceRegistryShardDatum }> {
  const utxo = await findUtxoByUnit(lucid, unit);
  if (!utxo.datum) {
    throw new Error(`Trace-registry shard ${unit} is missing inline datum`);
  }

  return {
    utxo,
    datum: decodeTraceRegistryShardDatum(utxo.datum, expectedBucketIndex),
  };
}

async function loadBucketEntrySet(
  lucid: LucidEvolution,
  registry: TraceRegistryConfig,
  bucket: RuntimeTraceRegistryDirectoryBucket,
): Promise<Set<string>> {
  const seen = new Set<string>();
  const tokenNames = Array.from(
    new Set([bucket.activeShardName, ...bucket.archivedShardNames]),
  );

  for (const tokenName of tokenNames) {
    const shard = await loadShardDatumByUnit(
      lucid,
      registry.shardPolicyId + tokenName,
      Number(bucket.bucketIndex),
    );
    for (const entry of shard.datum.entries) {
      seen.add(entry.voucherHash.toLowerCase());
    }
  }

  return seen;
}

async function chooseBenchmarkTrace(
  bucketIndex: number,
  runNonce: number,
  insertIndex: number,
  seenHashes: Set<string>,
): Promise<{ voucherHash: string; fullDenom: string }> {
  for (let attempt = 0; attempt < 100_000; attempt += 1) {
    const fullDenom =
      `transfer/channel-${bucketIndex}/benchmark-${runNonce}-${insertIndex}-${attempt}`;
    const voucherHash = await computeVoucherHash(fullDenom);
    if (bucketIndexForHash(voucherHash) !== bucketIndex) {
      continue;
    }
    if (seenHashes.has(voucherHash)) {
      continue;
    }
    return { voucherHash, fullDenom };
  }

  throw new Error(
    `Unable to derive a unique benchmark trace for bucket ${bucketIndex}`,
  );
}

function encodeIdentifierMintRedeemer(utxo: UTxO): string {
  return Data.to(
    {
      transaction_id: utxo.txHash,
      output_index: BigInt(utxo.outputIndex),
    },
    OutputReference,
  );
}

async function selectUniqueIdentifierNonce(
  lucid: LucidEvolution,
  bucket: RuntimeTraceRegistryDirectoryBucket,
): Promise<UTxO> {
  const reserved = new Set(
    [bucket.activeShardName, ...bucket.archivedShardNames].map((name) =>
      name.toLowerCase()
    ),
  );
  const walletUtxos = await lucid.wallet().getUtxos();

  for (const utxo of walletUtxos) {
    const candidateName = await generateIdentifierTokenName({
      transaction_id: utxo.txHash,
      output_index: BigInt(utxo.outputIndex),
    });
    if (!reserved.has(candidateName.toLowerCase())) {
      return utxo;
    }
  }

  throw new Error(
    "Unable to derive a fresh trace-registry shard identifier from the selected wallet UTxOs",
  );
}

function isLikelyTxSizeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return [
    "max transaction size",
    "maximum transaction size",
    "transaction too large",
    "max tx size",
    "tx too large",
    "maximum transaction size exceeded",
  ].some((pattern) => normalized.includes(pattern));
}

async function completeUnsignedTx(
  tx: TxBuilder,
) {
  return await tx.complete({ localUPLCEval: false });
}

async function submitCompletedTx(
  lucid: LucidEvolution,
  completedTx: Awaited<ReturnType<TxBuilder["complete"]>>,
  txName: string,
) {
  console.log("Submitting tx [", txName, "]");
  console.log(
    "Submitting tx [",
    txName,
    "]: size in bytes",
    completedTx.toCBOR().length / 2,
  );
  console.log("Submitting tx [", txName, "]: signing ...");
  const signedTx = await completedTx.sign.withWallet().complete();
  console.log(
    "Submitting tx [",
    txName,
    "]: signed tx size in bytes",
    signedTx.toCBOR().length / 2,
  );
  console.log("Submitting tx [", txName, "]: submitting ...");
  const txHash = await signedTx.submit();
  console.log("Submitting tx [", txName, "]: tx hash is", txHash);
  console.log("Submitting tx [", txName, "]: waiting for adoption ...");
  await lucid.awaitTx(txHash, 1000);
  console.log("Submitting tx [", txName, "]: done");
  return txHash;
}

async function prepareInsertContexts(
  lucid: LucidEvolution,
  registry: TraceRegistryConfig,
  voucherHash: string,
  fullDenom: string,
): Promise<PreparedInsertContexts> {
  const bucketIndex = bucketIndexForHash(voucherHash);
  const { utxo: directoryUtxo, datum: directoryDatum } =
    await loadDirectoryDatum(lucid, registry);
  const bucket = getDirectoryBucket(directoryDatum, bucketIndex);
  const activeShardUnit = registry.shardPolicyId + bucket.activeShardName;
  const { utxo: activeShardUtxo, datum: activeShardDatum } =
    await loadShardDatumByUnit(
      lucid,
      activeShardUnit,
      bucketIndex,
    );

  const duplicate = activeShardDatum.entries.find((entry) =>
    entry.voucherHash === voucherHash
  );
  if (duplicate) {
    if (duplicate.fullDenom !== fullDenom) {
      throw new Error(
        `Conflicting active trace-registry mapping for hash ${voucherHash}: existing=${duplicate.fullDenom}, incoming=${fullDenom}`,
      );
    }
    throw new Error(
      `Benchmark trace ${voucherHash} already exists in the active shard`,
    );
  }

  const append: TraceRegistryAppendInsertContext = {
    kind: "append",
    directoryUtxo,
    shardUtxo: activeShardUtxo,
    encodedTraceRegistryRedeemer: encodeTraceRegistryRedeemer({
      InsertTrace: {
        voucher_hash: voucherHash,
        full_denom: fullDenom,
      },
    }),
    encodedUpdatedTraceRegistryDatum: encodeTraceRegistryDatum(
      {
        bucketIndex: activeShardDatum.bucketIndex,
        entries: [
          ...activeShardDatum.entries,
          {
            voucherHash,
            fullDenom,
          },
        ],
      },
      "Shard",
    ),
  };

  const nonceUtxo = await selectUniqueIdentifierNonce(lucid, bucket);
  const newActiveShardName = await generateIdentifierTokenName({
    transaction_id: nonceUtxo.txHash,
    output_index: BigInt(nonceUtxo.outputIndex),
  });
  const updatedDirectory: RuntimeTraceRegistryDirectoryDatum = {
    buckets: directoryDatum.buckets.map((candidate) =>
      Number(candidate.bucketIndex) === bucketIndex
        ? {
          bucketIndex: candidate.bucketIndex,
          activeShardName: newActiveShardName,
          archivedShardNames: [
            ...candidate.archivedShardNames,
            candidate.activeShardName,
          ],
        }
        : candidate
    ),
  };

  const rollover: TraceRegistryRolloverInsertContext = {
    kind: "rollover",
    directoryUtxo,
    shardUtxo: activeShardUtxo,
    nonceUtxo,
    encodedTraceRegistryDirectoryRedeemer: encodeTraceRegistryRedeemer({
      AdvanceDirectory: {
        bucket_index: BigInt(bucketIndex),
        voucher_hash: voucherHash,
        full_denom: fullDenom,
        previous_active_shard_name: bucket.activeShardName,
        new_active_shard_name: newActiveShardName,
      },
    }),
    encodedUpdatedTraceRegistryDirectoryDatum: encodeTraceRegistryDatum(
      updatedDirectory,
      "Directory",
    ),
    encodedTraceRegistryRedeemer: encodeTraceRegistryRedeemer({
      RolloverInsertTrace: {
        voucher_hash: voucherHash,
        full_denom: fullDenom,
        new_active_shard_name: newActiveShardName,
      },
    }),
    encodedArchivedTraceRegistryDatum: encodeTraceRegistryDatum(
      activeShardDatum,
      "Shard",
    ),
    encodedNewActiveTraceRegistryDatum: encodeTraceRegistryDatum(
      {
        bucketIndex: BigInt(bucketIndex),
        entries: [
          {
            voucherHash,
            fullDenom,
          },
        ],
      },
      "Shard",
    ),
    newActiveTraceRegistryShardTokenUnit: registry.shardPolicyId +
      newActiveShardName,
    encodedMintIdentifierRedeemer: encodeIdentifierMintRedeemer(nonceUtxo),
  };

  return { append, rollover };
}

function buildAppendTx(
  lucid: LucidEvolution,
  references: BenchmarkReferenceScripts,
  traceRegistryAddress: string,
  sinkAddress: string,
  benchmarkTokenUnit: string,
  update: TraceRegistryAppendInsertContext,
): TxBuilder {
  return lucid
    .newTx()
    .readFrom([update.directoryUtxo])
    .attach.SpendingValidator(references.spendTraceRegistryValidator)
    .attach.MintingPolicy(references.mintTraceRegistryBenchmarkVoucherPolicy)
    .collectFrom([update.shardUtxo], update.encodedTraceRegistryRedeemer)
    .mintAssets(
      {
        [benchmarkTokenUnit]: BENCHMARK_VOUCHER_AMOUNT,
      },
      Data.void(),
    )
    .pay.ToContract(
      traceRegistryAddress,
      {
        kind: "inline",
        value: update.encodedUpdatedTraceRegistryDatum,
      },
      {
        ...update.shardUtxo.assets,
      },
    )
    .pay.ToAddress(sinkAddress, {
      lovelace: BENCHMARK_SINK_LOVELACE,
      [benchmarkTokenUnit]: BENCHMARK_VOUCHER_AMOUNT,
    });
}

function buildRolloverTx(
  lucid: LucidEvolution,
  references: BenchmarkReferenceScripts,
  traceRegistryAddress: string,
  sinkAddress: string,
  benchmarkTokenUnit: string,
  update: TraceRegistryRolloverInsertContext,
): TxBuilder {
  return lucid
    .newTx()
    .attach.SpendingValidator(references.spendTraceRegistryValidator)
    .attach.MintingPolicy(references.mintIdentifierPolicy)
    .attach.MintingPolicy(references.mintTraceRegistryBenchmarkVoucherPolicy)
    .collectFrom(
      [update.directoryUtxo],
      update.encodedTraceRegistryDirectoryRedeemer,
    )
    .collectFrom([update.shardUtxo], update.encodedTraceRegistryRedeemer)
    .collectFrom([update.nonceUtxo], Data.void())
    .mintAssets(
      {
        [update.newActiveTraceRegistryShardTokenUnit]: 1n,
      },
      update.encodedMintIdentifierRedeemer,
    )
    .mintAssets(
      {
        [benchmarkTokenUnit]: BENCHMARK_VOUCHER_AMOUNT,
      },
      Data.void(),
    )
    .pay.ToContract(
      traceRegistryAddress,
      {
        kind: "inline",
        value: update.encodedUpdatedTraceRegistryDirectoryDatum,
      },
      {
        ...update.directoryUtxo.assets,
      },
    )
    .pay.ToContract(
      traceRegistryAddress,
      {
        kind: "inline",
        value: update.encodedArchivedTraceRegistryDatum,
      },
      {
        ...update.shardUtxo.assets,
      },
    )
    .pay.ToContract(
      traceRegistryAddress,
      {
        kind: "inline",
        value: update.encodedNewActiveTraceRegistryDatum,
      },
      {
        [update.newActiveTraceRegistryShardTokenUnit]: 1n,
      },
    )
    .pay.ToAddress(sinkAddress, {
      lovelace: BENCHMARK_SINK_LOVELACE,
      [benchmarkTokenUnit]: BENCHMARK_VOUCHER_AMOUNT,
    });
}

async function submitBenchmarkInsert(
  lucid: LucidEvolution,
  registry: TraceRegistryConfig,
  references: BenchmarkReferenceScripts,
  benchmarkPolicyId: string,
  voucherHash: string,
  fullDenom: string,
): Promise<{ txHash: string; rollover: boolean }> {
  const benchmarkTokenUnit = benchmarkPolicyId + voucherHash;
  const sinkAddress = benchmarkSinkAddress(lucid);
  const { append, rollover } = await prepareInsertContexts(
    lucid,
    registry,
    voucherHash,
    fullDenom,
  );

  const appendTx = buildAppendTx(
    lucid,
    references,
    registry.address,
    sinkAddress,
    benchmarkTokenUnit,
    append,
  );

  const maxTxSize = lucid.config().protocolParameters?.maxTxSize ?? 16_384;

  try {
    // Complete the append path exactly once. Re-completing the same builder can
    // mutate coin-selection/witness state and makes the benchmark harder to
    // reason about when diagnosing live validator failures.
    const completedAppendTx = await completeUnsignedTx(appendTx);
    const unsignedSize = completedAppendTx.toCBOR().length / 2;

    if (
      unsignedSize <
        maxTxSize - TRACE_REGISTRY_TX_SIZE_HEADROOM_BYTES
    ) {
      const txHash = await submitCompletedTx(
        lucid,
        completedAppendTx,
        `BenchmarkTraceInsert ${voucherHash.slice(0, 8)}`,
      );
      return { txHash, rollover: false };
    }
  } catch (error) {
    if (!isLikelyTxSizeError(error)) {
      throw error;
    }
  }

  const rolloverTx = buildRolloverTx(
    lucid,
    references,
    registry.address,
    sinkAddress,
    benchmarkTokenUnit,
    rollover,
  );
  const completedRolloverTx = await completeUnsignedTx(rolloverTx);
  const txHash = await submitCompletedTx(
    lucid,
    completedRolloverTx,
    `BenchmarkTraceRollover ${voucherHash.slice(0, 8)}`,
  );
  return { txHash, rollover: true };
}

async function main() {
  const { bucket, inserts, json } = parseArgs(Deno.args);
  const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");
  if (cardanoNetworkMagic !== "42") {
    throw new Error(
      `benchmark-trace-registry-inserts only supports the local Cardano devnet (network magic 42), received ${
        String(cardanoNetworkMagic)
      }`,
    );
  }

  const lucid = await buildLucid();
  const deployment = loadDeploymentInfo();
  assertBenchmarkDeploymentMatchesCurrentValidators(deployment);
  const registry = getTraceRegistryConfig(deployment);
  const benchmarkPolicyId = benchmarkVoucherPolicyId(deployment);
  const references = await loadBenchmarkReferenceScripts(lucid, deployment);
  const { datum: directory } = await loadDirectoryDatum(lucid, registry);
  const initialBucket = getDirectoryBucket(directory, bucket);
  const seenHashes = await loadBucketEntrySet(lucid, registry, initialBucket);
  const runNonce = Date.now();
  const results: BenchmarkInsertResult[] = [];

  console.error(
    `Running local trace-registry benchmark inserts on bucket ${bucket} (${inserts} inserts, existing entries ${seenHashes.size})`,
  );

  for (let insertIndex = 1; insertIndex <= inserts; insertIndex += 1) {
    const { voucherHash, fullDenom } = await chooseBenchmarkTrace(
      bucket,
      runNonce,
      insertIndex,
      seenHashes,
    );
    console.error(
      `Insert ${insertIndex}/${inserts}: voucherHash=${voucherHash} fullDenom=${fullDenom}`,
    );
    const { txHash, rollover } = await submitBenchmarkInsert(
      lucid,
      registry,
      references,
      benchmarkPolicyId,
      voucherHash,
      fullDenom,
    );
    seenHashes.add(voucherHash);
    console.error(
      `Insert ${insertIndex}/${inserts} confirmed in tx ${txHash}${
        rollover ? " (rollover)" : ""
      }`,
    );
    results.push({
      insertIndex,
      voucherHash,
      fullDenom,
      bucket,
      txHash,
      rollover,
    });
  }

  const output = {
    bucket,
    inserts,
    benchmarkPolicyId,
    results,
  };
  console.log(JSON.stringify(output, null, json ? 2 : 0));
}

main().catch((error) => {
  console.error(
    `benchmark-trace-registry-inserts failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  Deno.exit(1);
});
