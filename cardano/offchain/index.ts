import {
  installManagedCardanoAuthFetch,
  resolveManagedKupoAuthUrl,
  resolveManagedKupoRequestVariants,
  resolveManagedKupoUrl,
  resolveManagedOgmiosUrl,
  resolveManagedKupmiosHeaders,
} from "./src/http_auth.ts";
const {
  parseNetwork,
  queryOgmiosJsonRpc,
  queryProtocolParametersCompat,
  resolveOgmiosHttpUrl,
  querySystemStart,
  sanitizeProtocolParameters,
} = await import("./src/external_cardano.ts");

const deployerSk = Deno.env.get("DEPLOYER_SK");
const kupoUrl = Deno.env.get("KUPO_URL");
const ogmiosUrl = Deno.env.get("OGMIOS_URL");
const kupoApiKey = Deno.env.get("KUPO_API_KEY")?.trim();
const ogmiosApiKey = Deno.env.get("OGMIOS_API_KEY")?.trim();
const kupoAuthUrl = kupoUrl ? resolveManagedKupoAuthUrl(kupoUrl) : undefined;
const kupoMatchesUrl = kupoUrl ? resolveManagedKupoUrl(kupoUrl, kupoApiKey) : undefined;
// Kupmios still issues plain HTTP POSTs for some internal provider calls, so it
// must target a header-authenticated Ogmios base host instead of the auth-subdomain
// websocket endpoint that we use for custom JSON-RPC calls.
const ogmiosProviderUrl = ogmiosUrl
  ? resolveManagedOgmiosUrl(resolveOgmiosHttpUrl(ogmiosUrl), ogmiosApiKey)
  : undefined;
const kupmiosHeaders = kupoUrl && ogmiosProviderUrl
  ? resolveManagedKupmiosHeaders(
    kupoUrl,
    ogmiosProviderUrl,
    kupoApiKey,
    ogmiosApiKey,
  )
  : undefined;
const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

if (!cardanoNetworkMagic) {
  throw new Error("CARDANO_NETWORK_MAGIC is not set in the environment variables");
}

if (!deployerSk || !kupoUrl || !ogmiosUrl) {
  throw new Error("Unable to load environment variables");
}

const DEFAULT_KUPMIOS_SUBMIT_TIMEOUT_MS = 60000;

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

const kupmiosSubmitTimeoutMs = parsePositiveIntEnv(
  "KUPMIOS_SUBMIT_TIMEOUT_MS",
  DEFAULT_KUPMIOS_SUBMIT_TIMEOUT_MS,
);
installManagedCardanoAuthFetch();
const chainZeroTime = await querySystemStart(ogmiosUrl);
const protocolParameters = sanitizeProtocolParameters(
  await queryProtocolParametersCompat(ogmiosUrl),
);
const { Kupmios, Lucid, SLOT_CONFIG_NETWORK, applyDoubleCborEncoding, fromUnit } = await import(
  "@lucid-evolution/lucid"
);
const { applySingleCborEncoding } = await import("npm:@lucid-evolution/utils");
const { createDeployment } = await import("./src/deployment.ts");
const { KUPMIOS_ENV } = await import("./src/constants.ts");

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
        return { language: "plutus:v1", cbor: applySingleCborEncoding(scriptRef.script) };
      case "PlutusV2":
        return { language: "plutus:v2", cbor: applySingleCborEncoding(scriptRef.script) };
      case "PlutusV3":
        return { language: "plutus:v3", cbor: applySingleCborEncoding(scriptRef.script) };
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
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      this.#submitTimeoutMs,
    );

    try {
      const parsedResponse = await queryOgmiosJsonRpc(
        this.#ogmiosUrl,
        "submitTransaction",
        {
          transaction: {
            cbor,
          },
        },
        this.#submitTimeoutMs,
        5,
      );

      const transactionId = parsedResponse?.result?.transaction?.id;
      if (!transactionId) {
        throw new Error(
          `submitTransaction returned no transaction id: ${JSON.stringify(parsedResponse)}`,
        );
      }

      return transactionId;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(
          `submitTransaction timed out after ${this.#submitTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  override async evaluateTx(tx: string, additionalUTxOs: any[]): Promise<any[]> {
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
          `Retrying managed Kupo request ${attempt}/${maxAttempts}: ${String(lastError)}`,
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

  async #fetchDatum(datumType?: string, datumHash?: string | null): Promise<string | undefined> {
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
        return { type: "PlutusV1", script: applyDoubleCborEncoding(result.script) };
      case "plutus:v2":
        return { type: "PlutusV2", script: applyDoubleCborEncoding(result.script) };
      case "plutus:v3":
        return { type: "PlutusV3", script: applyDoubleCborEncoding(result.script) };
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
      datumHash: utxo.datum_type === "hash" ? utxo.datum_hash ?? undefined : undefined,
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
    const queryPredicate = isAddress ? addressOrCredential : addressOrCredential.hash;
    return await this.#fetchMatchUtxos(
      `${this.#kupoMatchesUrl}/matches/${queryPredicate}${isAddress ? "" : "/*"}?unspent`,
    );
  }

  override async getUtxosWithUnit(addressOrCredential: any, unit: string): Promise<any[]> {
    const isAddress = typeof addressOrCredential === "string";
    const queryPredicate = isAddress ? addressOrCredential : addressOrCredential.hash;
    const { policyId, assetName } = fromUnit(unit);
    return await this.#fetchMatchUtxos(
      `${this.#kupoMatchesUrl}/matches/${queryPredicate}${isAddress ? "" : "/*"}?unspent&policy_id=${policyId}${assetName ? `&asset_name=${assetName}` : ""}`,
    );
  }

  override async getUtxoByUnit(unit: string): Promise<any> {
    const { policyId, assetName } = fromUnit(unit);
    const utxos = await this.#fetchMatchUtxos(
      `${this.#kupoMatchesUrl}/matches/${policyId}.${assetName ? assetName : "*"}?unspent`,
    );
    if (utxos.length > 1) {
      throw new Error("Unit needs to be an NFT or only held by one address.");
    }
    return utxos[0];
  }

  override async getUtxosByOutRef(outRefs: Array<{ txHash: string; outputIndex: number }>): Promise<any[]> {
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
        (outRef) => utxo.txHash === outRef.txHash && utxo.outputIndex === outRef.outputIndex,
      )
    );
  }

  override async awaitTx(txHash: string, checkInterval = 20000): Promise<boolean> {
    const timeoutAt = Date.now() + 160000;
    while (Date.now() < timeoutAt) {
      const utxos = await this.#fetchMatchUtxos(
        `${this.#kupoMatchesUrl}/matches/*@${txHash}?unspent`,
      );
      if (utxos.length > 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
    throw new Error(`Timed out waiting for tx ${txHash} to settle`);
  }
}

try {
  const provider = new ManagedDmtrKupmios(
    kupoAuthUrl ?? kupoUrl,
    kupoMatchesUrl ?? kupoUrl,
    ogmiosProviderUrl ?? ogmiosUrl,
    ogmiosUrl,
    kupmiosSubmitTimeoutMs,
    kupmiosHeaders,
  );
  if (kupmiosSubmitTimeoutMs !== 10000) {
    console.log(
      `Using extended Kupmios submit timeout: ${kupmiosSubmitTimeoutMs}ms`,
    );
  }
  SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
  const lucid = await Lucid(
    provider,
    parseNetwork(cardanoNetworkMagic),
    {
      presetProtocolParameters: protocolParameters,
    } as any,
  );

  lucid.selectWallet.fromPrivateKey(deployerSk);

  console.log("=".repeat(70));
  await createDeployment(lucid, KUPMIOS_ENV);
} catch (error) {
  console.error("ERR: ", error);
  throw error;
}
