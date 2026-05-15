import {
  Data,
  getAddressDetails,
  Kupmios,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  installManagedCardanoAuthFetch,
  resolveManagedKupmiosHeaders,
  resolveManagedKupoUrl,
  resolveManagedOgmiosUrl,
} from "../src/http_auth.ts";
import { resolveOgmiosHttpUrl } from "../src/external_cardano.ts";
import { buildLucidWithCompatibleProtocolParameters } from "../src/protocol_parameters.ts";
import {
  type DeploymentTemplate,
  readValidator,
  submitTx,
} from "../src/utils.ts";
import {
  HostStateDatum,
  type HostStateDatum as HostStateDatumType,
  HostStateRedeemer,
  type HostStateRedeemer as HostStateRedeemerType,
} from "../types/index.ts";

type Command = "status" | "enter" | "reclaim-reference-scripts" | "finalize";

type ScriptArgs = {
  command: Command;
  handlerJsonPath: string;
  gracePeriodEnd?: number;
  gracePeriodMs?: number;
  batchSize: number;
};

const DEFAULT_HANDLER_JSON_PATH = "./deployments/handler.json";
const DEFAULT_REFERENCE_RECLAIM_BATCH_SIZE = 10;
const TX_VALIDITY_WINDOW_MS = 10 * 60 * 1000;

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  deno run --env-file=.env.default --allow-net --allow-env --allow-read --allow-run --allow-ffi scripts/shutdown-deployment.ts status [--handler-json <path>]",
      "  deno run --env-file=.env.default --allow-net --allow-env --allow-read --allow-run --allow-ffi scripts/shutdown-deployment.ts enter (--grace-period-ms <ms> | --grace-period-end <unix-ms>) [--handler-json <path>]",
      "  deno run --env-file=.env.default --allow-net --allow-env --allow-read --allow-run --allow-ffi scripts/shutdown-deployment.ts reclaim-reference-scripts [--batch-size <n>] [--handler-json <path>]",
      "  deno run --env-file=.env.default --allow-net --allow-env --allow-read --allow-run --allow-ffi scripts/shutdown-deployment.ts finalize [--handler-json <path>]",
    ].join("\n"),
  );
}

function parsePositiveInt(raw: string | undefined, name: string): number {
  if (!raw) {
    usage();
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer, received ${raw}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ScriptArgs {
  const command = argv[0] as Command | undefined;
  if (
    command !== "status" &&
    command !== "enter" &&
    command !== "reclaim-reference-scripts" &&
    command !== "finalize"
  ) {
    usage();
  }

  let handlerJsonPath = DEFAULT_HANDLER_JSON_PATH;
  let gracePeriodEnd: number | undefined;
  let gracePeriodMs: number | undefined;
  let batchSize = DEFAULT_REFERENCE_RECLAIM_BATCH_SIZE;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--handler-json":
        handlerJsonPath = argv[index + 1];
        index += 1;
        break;
      case "--grace-period-end":
        gracePeriodEnd = parsePositiveInt(argv[index + 1], arg);
        index += 1;
        break;
      case "--grace-period-ms":
        gracePeriodMs = parsePositiveInt(argv[index + 1], arg);
        index += 1;
        break;
      case "--batch-size":
        batchSize = parsePositiveInt(argv[index + 1], arg);
        index += 1;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!handlerJsonPath) {
    usage();
  }

  if (command === "enter" && !gracePeriodEnd && !gracePeriodMs) {
    throw new Error(
      "enter requires --grace-period-ms or --grace-period-end",
    );
  }
  if (command !== "enter" && (gracePeriodEnd || gracePeriodMs)) {
    throw new Error(
      "--grace-period-ms and --grace-period-end are only valid for enter",
    );
  }
  if (gracePeriodEnd && gracePeriodMs) {
    throw new Error("Use only one of --grace-period-ms or --grace-period-end");
  }

  return {
    command,
    handlerJsonPath,
    gracePeriodEnd,
    gracePeriodMs,
    batchSize,
  };
}

async function buildLucid(): Promise<LucidEvolution> {
  const deployerSk = Deno.env.get("DEPLOYER_SK");
  const kupoUrl = Deno.env.get("KUPO_URL");
  const ogmiosUrl = Deno.env.get("OGMIOS_URL");
  const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");
  const kupoApiKey = Deno.env.get("KUPO_API_KEY")?.trim();
  const ogmiosApiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();

  if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
    throw new Error("Missing required Cardano offchain environment variables");
  }

  installManagedCardanoAuthFetch();
  const ogmiosProviderUrl = resolveManagedOgmiosUrl(
    resolveOgmiosHttpUrl(ogmiosUrl),
    ogmiosApiKey,
  );
  const provider = new Kupmios(
    resolveManagedKupoUrl(kupoUrl, kupoApiKey),
    ogmiosProviderUrl,
    resolveManagedKupmiosHeaders(
      kupoUrl,
      ogmiosProviderUrl,
      kupoApiKey,
      ogmiosApiKey,
    ),
  );
  const lucid = await buildLucidWithCompatibleProtocolParameters(
    provider,
    ogmiosUrl,
    cardanoNetworkMagic,
  );
  lucid.selectWallet.fromPrivateKey(deployerSk);
  return lucid;
}

async function loadDeployment(path: string): Promise<DeploymentTemplate> {
  return JSON.parse(await Deno.readTextFile(path)) as DeploymentTemplate;
}

function normalizeAssets(
  assets: Record<string, bigint | number | string>,
): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(assets).map(([unit, amount]) => [
      unit,
      typeof amount === "bigint" ? amount : BigInt(amount),
    ]),
  );
}

function normalizeUtxo(utxo: UTxO): UTxO {
  return {
    ...utxo,
    assets: normalizeAssets(
      utxo.assets as Record<string, bigint | number | string>,
    ),
  };
}

async function refreshUtxoByRef(lucid: LucidEvolution, utxo: UTxO) {
  const [liveUtxo] = await lucid.utxosByOutRef([
    {
      txHash: utxo.txHash,
      outputIndex: utxo.outputIndex,
    },
  ]);
  if (!liveUtxo) {
    throw new Error(`UTxO ${utxo.txHash}#${utxo.outputIndex} is not live`);
  }
  return liveUtxo;
}

function deployerPaymentKeyHash(address: string): string {
  const paymentCredential = getAddressDetails(address).paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error(
      `Deployment wallet address does not have a key payment credential: ${address}`,
    );
  }
  return paymentCredential.hash;
}

function hostStateUnit(deployment: DeploymentTemplate): string {
  if (!deployment.hostStateNFT) {
    throw new Error("handler.json does not contain hostStateNFT");
  }
  return deployment.hostStateNFT.policyId + deployment.hostStateNFT.name;
}

async function getHostStateUtxo(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
): Promise<UTxO> {
  const utxo = await lucid.utxoByUnit(hostStateUnit(deployment));
  if (!utxo.datum) {
    throw new Error(
      `HostState UTxO ${utxo.txHash}#${utxo.outputIndex} has no inline datum`,
    );
  }
  return utxo;
}

function decodeHostStateDatum(utxo: UTxO): HostStateDatumType {
  if (!utxo.datum) {
    throw new Error(
      `HostState UTxO ${utxo.txHash}#${utxo.outputIndex} has no inline datum`,
    );
  }
  return Data.from(utxo.datum, HostStateDatum) as HostStateDatumType;
}

function shutdownGracePeriodEnd(datum: HostStateDatumType): bigint | undefined {
  if (datum.shutdown === "Active") {
    return undefined;
  }
  return datum.shutdown.ShuttingDown.grace_period_end;
}

function requireShutdownGracePeriodEnd(datum: HostStateDatumType): number {
  const gracePeriodEnd = shutdownGracePeriodEnd(datum);
  if (gracePeriodEnd === undefined) {
    throw new Error("HostState is active; enter shutdown before reclaiming");
  }
  const parsed = Number(gracePeriodEnd);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `Shutdown grace_period_end is not a safe JavaScript timestamp: ${gracePeriodEnd.toString()}`,
    );
  }
  return parsed;
}

function requireGracePeriodElapsed(gracePeriodEnd: number): number {
  const now = Date.now();
  if (now < gracePeriodEnd) {
    throw new Error(
      `Shutdown grace period has not elapsed: now=${now}, grace_period_end=${gracePeriodEnd}`,
    );
  }
  return now;
}

async function status(lucid: LucidEvolution, deployment: DeploymentTemplate) {
  const walletAddress = await lucid.wallet().address();
  const hostUtxo = await getHostStateUtxo(lucid, deployment);
  const hostDatum = decodeHostStateDatum(hostUtxo);
  const [, , referenceValidatorAddress] = await readValidator(
    "reference_validator.refer_only.else",
    lucid,
    [deployment.hostStateNFT!.policyId],
    Data.Tuple([Data.Bytes()]) as unknown as [string],
  );
  const referenceScriptUtxos = (await lucid.utxosAt(referenceValidatorAddress))
    .filter((utxo) => utxo.scriptRef);

  console.log(
    JSON.stringify(
      {
        walletAddress,
        hostState: {
          unit: hostStateUnit(deployment),
          utxo: `${hostUtxo.txHash}#${hostUtxo.outputIndex}`,
          shutdown: hostDatum.shutdown,
        },
        referenceScripts: {
          address: referenceValidatorAddress,
          liveUtxos: referenceScriptUtxos.length,
        },
      },
      null,
      2,
    ),
  );
}

async function enterShutdown(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  gracePeriodEnd: number,
) {
  const hostUtxo = await getHostStateUtxo(lucid, deployment);
  const currentDatum = decodeHostStateDatum(hostUtxo);
  if (currentDatum.shutdown !== "Active") {
    throw new Error("HostState is already shutting down");
  }

  const now = Date.now();
  if (gracePeriodEnd <= now) {
    throw new Error(
      `grace period end ${gracePeriodEnd} must be after current time ${now}`,
    );
  }

  const walletAddress = await lucid.wallet().address();
  const signerKeyHash = deployerPaymentKeyHash(walletAddress);
  const updatedDatum: HostStateDatumType = {
    ...currentDatum,
    state: {
      ...currentDatum.state,
      version: currentDatum.state.version + 1n,
      last_update_time: BigInt(now),
    },
    shutdown: {
      ShuttingDown: {
        initiated_at: BigInt(now),
        grace_period_end: BigInt(gracePeriodEnd),
      },
    },
  };
  const redeemer: HostStateRedeemerType = {
    EnterShutdown: { grace_period_end: BigInt(gracePeriodEnd) },
  };
  const hostStateSttReferenceUtxo = await refreshUtxoByRef(
    lucid,
    normalizeUtxo(deployment.validators.hostStateStt.refUtxo),
  );

  const txHash = await submitTx(
    () =>
      lucid
        .newTx()
        .readFrom([hostStateSttReferenceUtxo])
        .collectFrom(
          [hostUtxo],
          Data.to(redeemer, HostStateRedeemer, { canonical: true }),
        )
        .pay.ToContract(
          deployment.validators.hostStateStt.address,
          {
            kind: "inline",
            value: Data.to(updatedDatum, HostStateDatum, { canonical: true }),
          },
          hostUtxo.assets,
        )
        .addSignerKey(signerKeyHash)
        .validFrom(now)
        .validTo(now + TX_VALIDITY_WINDOW_MS),
    lucid,
    "EnterDeploymentShutdown",
  );

  console.log(
    JSON.stringify(
      {
        txHash,
        initiatedAt: now,
        gracePeriodEnd,
      },
      null,
      2,
    ),
  );
}

async function reclaimReferenceScripts(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  batchSize: number,
) {
  const walletAddress = await lucid.wallet().address();
  const signerKeyHash = deployerPaymentKeyHash(walletAddress);
  const hostUtxo = await getHostStateUtxo(lucid, deployment);
  const hostDatum = decodeHostStateDatum(hostUtxo);
  const gracePeriodEnd = requireShutdownGracePeriodEnd(hostDatum);
  const validFrom = requireGracePeriodElapsed(gracePeriodEnd);

  const [referenceValidator, , referenceValidatorAddress] = await readValidator(
    "reference_validator.refer_only.else",
    lucid,
    [deployment.hostStateNFT!.policyId],
    Data.Tuple([Data.Bytes()]) as unknown as [string],
  );
  const referenceScriptUtxos = (await lucid.utxosAt(referenceValidatorAddress))
    .filter((utxo) => utxo.scriptRef);

  if (referenceScriptUtxos.length === 0) {
    console.log("No reclaimable reference-script UTxOs found.");
    return;
  }

  const txHashes: string[] = [];
  for (
    let index = 0;
    index < referenceScriptUtxos.length;
    index += batchSize
  ) {
    const batch = referenceScriptUtxos.slice(index, index + batchSize);
    const txHash = await submitTx(
      () =>
        lucid
          .newTx()
          .readFrom([hostUtxo])
          .attach.SpendingValidator(referenceValidator)
          .collectFrom(batch, Data.void())
          .addSignerKey(signerKeyHash)
          .validFrom(validFrom)
          .validTo(validFrom + TX_VALIDITY_WINDOW_MS),
      lucid,
      `ReclaimReferenceScripts ${index + 1}-${index + batch.length}`,
    );
    txHashes.push(txHash);
  }

  console.log(
    JSON.stringify(
      {
        reclaimedUtxos: referenceScriptUtxos.length,
        batchSize,
        txHashes,
      },
      null,
      2,
    ),
  );
}

async function finalizeShutdown(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
) {
  const walletAddress = await lucid.wallet().address();
  const signerKeyHash = deployerPaymentKeyHash(walletAddress);
  const hostUtxo = await getHostStateUtxo(lucid, deployment);
  const hostDatum = decodeHostStateDatum(hostUtxo);
  const gracePeriodEnd = requireShutdownGracePeriodEnd(hostDatum);
  const validFrom = requireGracePeriodElapsed(gracePeriodEnd);

  const txHash = await submitTx(
    () =>
      lucid
        .newTx()
        .attach.SpendingValidator({
          type: "PlutusV3",
          script: deployment.validators.hostStateStt.script,
        })
        .collectFrom(
          [hostUtxo],
          Data.to("FinalizeShutdown", HostStateRedeemer, { canonical: true }),
        )
        .pay.ToAddress(walletAddress, hostUtxo.assets)
        .addSignerKey(signerKeyHash)
        .validFrom(validFrom)
        .validTo(validFrom + TX_VALIDITY_WINDOW_MS),
    lucid,
    "FinalizeDeploymentShutdown",
  );

  console.log(JSON.stringify({ txHash }, null, 2));
}

async function main() {
  const args = parseArgs(Deno.args);
  const deployment = await loadDeployment(args.handlerJsonPath);
  const lucid = await buildLucid();

  switch (args.command) {
    case "status":
      await status(lucid, deployment);
      break;
    case "enter": {
      const gracePeriodEnd = args.gracePeriodEnd ??
        Date.now() + args.gracePeriodMs!;
      await enterShutdown(lucid, deployment, gracePeriodEnd);
      break;
    }
    case "reclaim-reference-scripts":
      await reclaimReferenceScripts(lucid, deployment, args.batchSize);
      break;
    case "finalize":
      await finalizeShutdown(lucid, deployment);
      break;
  }
}

main().catch((error) => {
  console.error(
    `shutdown-deployment failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  Deno.exit(1);
});
