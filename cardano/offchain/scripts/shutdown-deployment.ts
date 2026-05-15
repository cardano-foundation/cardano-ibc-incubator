import {
  applyDoubleCborEncoding,
  Data,
  fromUnit,
  getAddressDetails,
  Kupmios,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import { applySingleCborEncoding } from "@lucid-evolution/utils";
import {
  installManagedCardanoAuthFetch,
  resolveManagedKupmiosHeaders,
  resolveManagedKupoAuthUrl,
  resolveManagedKupoRequestVariants,
  resolveManagedKupoUrl,
  resolveManagedOgmiosUrl,
} from "../src/http_auth.ts";
import {
  queryOgmiosJsonRpc,
  resolveOgmiosHttpUrl,
} from "../src/external_cardano.ts";
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
const DEFAULT_KUPMIOS_SUBMIT_TIMEOUT_MS = 60000;
const TX_VALIDITY_WINDOW_MS = 10 * 60 * 1000;

function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry,
    2,
  );
}

type RawKupoValue = {
  coins: number;
  assets: Record<string, number>;
};

type RawKupoUtxo = {
  transaction_id: string;
  output_index: number;
  address: string;
  value: RawKupoValue;
  datum_hash: string | null;
  datum_type?: "hash" | "inline";
  script_hash: string | null;
};

function toOgmiosAdditionalUtxos(utxos: any[] = []): any[] {
  const toOgmiosScript = (scriptRef: any) => {
    if (!scriptRef) {
      return null;
    }

    switch (scriptRef.type) {
      case "PlutusV1":
        return {
          language: "plutus:v1",
          cbor: applySingleCborEncoding(scriptRef.script),
        };
      case "PlutusV2":
        return {
          language: "plutus:v2",
          cbor: applySingleCborEncoding(scriptRef.script),
        };
      case "PlutusV3":
        return {
          language: "plutus:v3",
          cbor: applySingleCborEncoding(scriptRef.script),
        };
      default:
        return null;
    }
  };

  const toOgmiosAssets = (assets: Record<string, bigint>) => {
    const mapped: Record<string, Record<string, number>> = {};
    Object.entries(assets ?? {}).forEach(([unit, amount]) => {
      if (unit === "lovelace") {
        return;
      }

      const { policyId, assetName } = fromUnit(unit);
      if (!mapped[policyId]) {
        mapped[policyId] = {};
      }
      mapped[policyId][assetName || ""] = Number(amount);
    });
    return mapped;
  };

  return utxos.map((utxo) => ({
    transaction: { id: utxo.txHash },
    index: utxo.outputIndex,
    address: utxo.address,
    value: {
      ada: { lovelace: Number(utxo.assets["lovelace"]) },
      ...toOgmiosAssets(utxo.assets),
    },
    datumHash: utxo.datumHash,
    datum: utxo.datum,
    script: toOgmiosScript(utxo.scriptRef),
  }));
}

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const rawValue = Deno.env.get(name);
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid ${name} value '${rawValue}', using default ${defaultValue}.`,
    );
    return defaultValue;
  }

  return parsed;
}

class KupmiosWithExtendedSubmitTimeout extends Kupmios {
  #ogmiosUrl: string;
  #submitTimeoutMs: number;

  constructor(
    kupoUrl: string,
    ogmiosProviderUrl: string,
    ogmiosRpcUrl: string,
    submitTimeoutMs: number,
    headers?: Record<string, Record<string, string>>,
  ) {
    super(kupoUrl, ogmiosProviderUrl, headers);
    this.#ogmiosUrl = ogmiosRpcUrl;
    this.#submitTimeoutMs = submitTimeoutMs;
  }

  override async submitTx(cbor: string): Promise<string> {
    const parsedResponse = await queryOgmiosJsonRpc(
      this.#ogmiosUrl,
      "submitTransaction",
      {
        transaction: { cbor },
      },
      this.#submitTimeoutMs,
      5,
    );

    const transactionId = parsedResponse?.result?.transaction?.id;
    if (!transactionId) {
      throw new Error(
        `submitTransaction returned no transaction id: ${
          JSON.stringify(parsedResponse)
        }`,
      );
    }

    return transactionId;
  }

  override async evaluateTx(
    tx: string,
    additionalUTxOs: any[],
  ): Promise<any[]> {
    const parsedResponse = await queryOgmiosJsonRpc(
      this.#ogmiosUrl,
      "evaluateTransaction",
      {
        transaction: { cbor: tx },
        additionalUtxo: toOgmiosAdditionalUtxos(additionalUTxOs),
      },
      this.#submitTimeoutMs,
      5,
    );

    const result = parsedResponse?.result ?? [];
    return result.map((item: any) => ({
      ex_units: {
        mem: item.budget.memory,
        steps: item.budget.cpu,
      },
      redeemer_index: item.validator.index,
      redeemer_tag: item.validator.purpose,
    }));
  }
}

class ManagedDmtrKupmios extends KupmiosWithExtendedSubmitTimeout {
  #kupoAuthUrl: string;
  #kupoMatchesUrl: string;
  #kupoRequestVariants: Array<{
    baseUrl: string;
    headers?: Record<string, string>;
  }>;
  #kupoMatchHeaders?: Record<string, string>;

  constructor(
    kupoAuthUrl: string,
    kupoMatchesUrl: string,
    ogmiosProviderUrl: string,
    ogmiosRpcUrl: string,
    submitTimeoutMs: number,
    headers?: Record<string, Record<string, string>>,
  ) {
    super(
      kupoAuthUrl,
      ogmiosProviderUrl,
      ogmiosRpcUrl,
      submitTimeoutMs,
      headers,
    );
    this.#kupoAuthUrl = kupoAuthUrl;
    this.#kupoMatchesUrl = kupoMatchesUrl;
    this.#kupoRequestVariants = resolveManagedKupoRequestVariants(
      kupoAuthUrl,
      Deno.env.get("KUPO_API_KEY")?.trim(),
    );
    this.#kupoMatchHeaders = headers?.kupoHeader;
  }

  async #curlJson<T>(
    variants: Array<{
      url: string;
      headers?: Record<string, string>;
    }>,
  ): Promise<T> {
    let lastError: Error | null = null;
    const maxAttempts = 15;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      for (const variant of variants) {
        const args = [
          "-sS",
          "--connect-timeout",
          "10",
          "--max-time",
          "20",
        ];
        for (const [name, value] of Object.entries(variant.headers ?? {})) {
          args.push("-H", `${name}: ${value}`);
        }
        args.push(variant.url, "-w", "\n%{http_code}");

        const output = await new Deno.Command("/usr/bin/curl", {
          args,
          stdout: "piped",
          stderr: "piped",
        }).output();

        const stderr = new TextDecoder().decode(output.stderr).trim();
        if (!output.success) {
          lastError = new Error(stderr || `curl failed for ${variant.url}`);
          continue;
        }

        const stdout = new TextDecoder().decode(output.stdout);
        const separator = stdout.lastIndexOf("\n");
        const body = separator >= 0 ? stdout.slice(0, separator) : stdout;
        const statusText = separator >= 0
          ? stdout.slice(separator + 1).trim()
          : "500";
        const status = Number.parseInt(statusText, 10) || 500;
        if (status >= 200 && status < 300) {
          return JSON.parse(body) as T;
        }

        const headerNames = Object.keys(variant.headers ?? {});
        lastError = new Error(
          `${status} GET ${variant.url} (headers=${
            headerNames.join(",") || "none"
          }): ${body || stderr}`,
        );

        if (status < 500 && status !== 401 && status !== 429) {
          break;
        }
      }

      if (attempt < maxAttempts) {
        console.warn(
          `Retrying managed Kupo request ${attempt}/${maxAttempts}: ${
            String(lastError)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw lastError ?? new Error("curl failed for every managed Kupo variant");
  }

  async #fetchJson<T>(
    url: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    if (
      url.startsWith(this.#kupoMatchesUrl) ||
      url.startsWith(this.#kupoAuthUrl)
    ) {
      const parsedUrl = new URL(url);
      const requestPath = `${parsedUrl.pathname}${parsedUrl.search}`;
      const variants = this.#kupoRequestVariants.map((variant) => ({
        url: `${variant.baseUrl}${requestPath}`,
        headers: {
          ...(variant.headers ?? {}),
          ...(headers ?? {}),
        },
      }));
      return await this.#curlJson<T>(variants);
    }

    const response = await fetch(url, { headers });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} GET ${url}: ${responseText}`);
    }
    return JSON.parse(responseText) as T;
  }

  #toAssets(value: RawKupoValue): Record<string, bigint> {
    const assets: Record<string, bigint> = {
      lovelace: BigInt(value.coins),
    };
    for (const [unit, amount] of Object.entries(value.assets ?? {})) {
      assets[unit.replace(".", "")] = BigInt(amount);
    }
    return assets;
  }

  async #fetchDatum(
    datumType?: string,
    datumHash?: string | null,
  ): Promise<string | undefined> {
    if (datumType !== "inline" || !datumHash) {
      return undefined;
    }
    const result = await this.#fetchJson<{ datum: string }>(
      `${this.#kupoAuthUrl}/datums/${datumHash}`,
    );
    return result.datum;
  }

  async #fetchScript(scriptHash?: string | null): Promise<any> {
    if (!scriptHash) {
      return undefined;
    }
    const result = await this.#fetchJson<{ language: string; script: string }>(
      `${this.#kupoAuthUrl}/scripts/${scriptHash}`,
    );
    switch (result.language) {
      case "native":
        return { type: "Native", script: result.script };
      case "plutus:v1":
        return {
          type: "PlutusV1",
          script: applyDoubleCborEncoding(result.script),
        };
      case "plutus:v2":
        return {
          type: "PlutusV2",
          script: applyDoubleCborEncoding(result.script),
        };
      case "plutus:v3":
        return {
          type: "PlutusV3",
          script: applyDoubleCborEncoding(result.script),
        };
      default:
        return undefined;
    }
  }

  async #toLucidUtxos(utxos: RawKupoUtxo[]): Promise<any[]> {
    return await Promise.all(utxos.map(async (utxo) => ({
      txHash: utxo.transaction_id,
      outputIndex: utxo.output_index,
      address: utxo.address,
      assets: this.#toAssets(utxo.value),
      datumHash: utxo.datum_type === "hash"
        ? utxo.datum_hash ?? undefined
        : undefined,
      datum: await this.#fetchDatum(utxo.datum_type, utxo.datum_hash),
      scriptRef: await this.#fetchScript(utxo.script_hash),
    })));
  }

  async #fetchMatchUtxos(pattern: string): Promise<any[]> {
    const rawUtxos = await this.#fetchJson<RawKupoUtxo[]>(
      pattern,
      this.#kupoMatchHeaders,
    );
    return await this.#toLucidUtxos(rawUtxos);
  }

  override async getUtxos(addressOrCredential: any): Promise<any[]> {
    const isAddress = typeof addressOrCredential === "string";
    const queryPredicate = isAddress
      ? addressOrCredential
      : addressOrCredential.hash;
    return await this.#fetchMatchUtxos(
      `${this.#kupoMatchesUrl}/matches/${queryPredicate}${
        isAddress ? "" : "/*"
      }?unspent`,
    );
  }

  override async getUtxosWithUnit(
    addressOrCredential: any,
    unit: string,
  ): Promise<any[]> {
    const isAddress = typeof addressOrCredential === "string";
    const queryPredicate = isAddress
      ? addressOrCredential
      : addressOrCredential.hash;
    const { policyId, assetName } = fromUnit(unit);
    return await this.#fetchMatchUtxos(
      `${this.#kupoMatchesUrl}/matches/${queryPredicate}${
        isAddress ? "" : "/*"
      }?unspent&policy_id=${policyId}${
        assetName ? `&asset_name=${assetName}` : ""
      }`,
    );
  }

  override async getUtxoByUnit(unit: string): Promise<any> {
    const { policyId, assetName } = fromUnit(unit);
    const utxos = await this.#fetchMatchUtxos(
      `${this.#kupoMatchesUrl}/matches/${policyId}.${
        assetName ? assetName : "*"
      }?unspent`,
    );
    if (utxos.length > 1) {
      throw new Error("Unit needs to be an NFT or only held by one address.");
    }
    return utxos[0];
  }

  override async getUtxosByOutRef(
    outRefs: Array<{ txHash: string; outputIndex: number }>,
  ): Promise<any[]> {
    const queryHashes = [...new Set(outRefs.map((outRef) => outRef.txHash))];
    const utxos = (
      await Promise.all(
        queryHashes.map((txHash) =>
          this.#fetchMatchUtxos(
            `${this.#kupoMatchesUrl}/matches/*@${txHash}?unspent`,
          )
        ),
      )
    ).flat();
    return utxos.filter((utxo) =>
      outRefs.some(
        (outRef) =>
          utxo.txHash === outRef.txHash &&
          utxo.outputIndex === outRef.outputIndex,
      )
    );
  }

  override async awaitTx(txHash: string): Promise<boolean> {
    const timeoutAt = Date.now() + 160000;
    while (Date.now() < timeoutAt) {
      const utxos = await this.#fetchMatchUtxos(
        `${this.#kupoMatchesUrl}/matches/*@${txHash}?unspent`,
      );
      if (utxos.length > 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 20000));
    }
    throw new Error(`Timed out waiting for tx ${txHash} to settle`);
  }
}

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
  const kupmiosSubmitTimeoutMs = parsePositiveIntEnv(
    "KUPMIOS_SUBMIT_TIMEOUT_MS",
    DEFAULT_KUPMIOS_SUBMIT_TIMEOUT_MS,
  );
  const provider = new ManagedDmtrKupmios(
    resolveManagedKupoAuthUrl(kupoUrl),
    resolveManagedKupoUrl(kupoUrl, kupoApiKey),
    ogmiosProviderUrl,
    ogmiosUrl,
    kupmiosSubmitTimeoutMs,
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

  console.log(toJson({
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
  }));
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

  console.log(toJson({
    txHash,
    initiatedAt: now,
    gracePeriodEnd,
  }));
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

  console.log(toJson({
    reclaimedUtxos: referenceScriptUtxos.length,
    batchSize,
    txHashes,
  }));
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

  console.log(toJson({ txHash }));
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
