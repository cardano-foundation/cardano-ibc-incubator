import blueprint from "../../onchain/plutus.json" with { type: "json" };
import { crypto } from "@std/crypto";
import {
  resolveManagedKupoRequestVariants,
  resolveManagedKupoHeader,
  resolveManagedKupoUrl,
} from "./http_auth.ts";
import {
  Address,
  applyParamsToScript,
  Data,
  Exact,
  fromHex,
  fromText,
  LucidEvolution,
  Script,
  ScriptHash,
  toHex,
  TxBuilder,
  UTxO,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { AuthToken, OutputReference } from "../types/index.ts";

const RETRYABLE_OGMIOS_TRANSPORT_MARKERS = [
  "WebSocket closed before evaluateTransaction returned a response",
  "Timed out waiting for evaluateTransaction response",
  "WebSocket closed before submitTransaction returned a response",
  "Timed out waiting for submitTransaction response",
  "Unexpected server response: 401",
];

export const isRetryableOgmiosTransportError = (error: unknown): boolean => {
  const errorText = error instanceof Error
    ? `${error.message}\n${error.stack ?? ""}`
    : String(error);

  return RETRYABLE_OGMIOS_TRANSPORT_MARKERS.some((marker) =>
    errorText.includes(marker)
  );
};

export const readValidator = <T extends unknown[] = Data[]>(
  title: string,
  lucid: LucidEvolution,
  params?: Exact<[...T]>,
  type?: T,
): [Script, ScriptHash, Address] => {
  const rawValidator = blueprint.validators.find(
    (v: { title: string; compiledCode: string }) => v.title === title,
  );
  if (!rawValidator) {
    throw new Error(`Unable to field validator with title ${title}`);
  }

  let validator: Script;
  if (params === undefined) {
    validator = {
      type: "PlutusV3",
      script: rawValidator.compiledCode,
    };
  } else {
    validator = {
      type: "PlutusV3",
      script: applyParamsToScript(rawValidator.compiledCode, params, type),
    };
  }

  return [
    validator,
    validatorToScriptHash(validator),
    validatorToAddress(lucid.config().network || "Custom", validator),
  ];
};

export const submitTx = async (
  tx: TxBuilder | (() => TxBuilder | Promise<TxBuilder>),
  lucid: LucidEvolution,
  txName: string,
  logSize = true,
  localUPLCEval = false, // Default to false to use Ogmios for script evaluation
) => {
  const ADOPTION_ATTEMPTS = 6;
  const ADOPTION_TIMEOUT_MS = 30000;
  const ADOPTION_RETRY_DELAY_MS = 5000;
  const COMPLETE_ATTEMPTS = 5;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const awaitTxWithTimeout = async (hash: string) => {
    await Promise.race([
      awaitWalletTx(lucid, hash, 1000, ADOPTION_TIMEOUT_MS),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting ${ADOPTION_TIMEOUT_MS}ms for tx adoption`,
              ),
            ),
          ADOPTION_TIMEOUT_MS,
        )
      ),
    ]);
  };

  console.log("Submitting tx [", txName, "]");
  const buildTx = async () =>
    typeof tx === "function"
      ? await tx()
      : tx;
  let completedTx;
  let lastCompletionError: unknown = null;
  for (let attempt = 1; attempt <= COMPLETE_ATTEMPTS; attempt += 1) {
    try {
      // Rebuild the transaction from scratch on each completion retry. Lucid's
      // TxBuilder is stateful, so reusing the same builder after a transient
      // Ogmios failure can duplicate mint entries or other accumulated effects.
      completedTx = await (await buildTx()).complete({ localUPLCEval });
      lastCompletionError = null;
      break;
    } catch (error) {
      lastCompletionError = error;
      if (
        !isRetryableOgmiosTransportError(error) || attempt === COMPLETE_ATTEMPTS
      ) {
        throw error;
      }
      console.warn(
        `Submitting tx [ ${txName} ]: complete retry ${attempt}/${COMPLETE_ATTEMPTS} after transient Ogmios transport error:`,
        error,
      );
      await sleep(2000);
    }
  }
  if (!completedTx) {
    throw lastCompletionError ?? new Error(`Failed to complete tx '${txName}'`);
  }
  if (logSize) {
    console.log(
      "Submitting tx [",
      txName,
      "]: size in bytes",
      completedTx.toCBOR().length / 2,
    );
  }
  console.log("Submitting tx [", txName, "]: signing ...");
  const signedTx = await completedTx.sign.withWallet().complete();
  console.log(
    "Submitting tx [",
    txName,
    "]: signed tx size in bytes",
    signedTx.toCBOR().length / 2,
  );
  // Treat the signed body hash as the canonical tx identity up front. A submit
  // attempt can succeed on-chain even when Ogmios drops the response before
  // returning the transaction id, so retries must not depend on recovering the
  // hash from the transport response.
  let txHash: string | null = signedTx.toHash();
  console.log("Submitting tx [", txName, "]: tx hash is", txHash);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ADOPTION_ATTEMPTS; attempt++) {
    try {
      console.log(
        "Submitting tx [",
        txName,
        `]: submitting (attempt ${attempt}/${ADOPTION_ATTEMPTS}) ...`,
      );
      const submittedHash = await signedTx.submit();
      if (submittedHash !== txHash) {
        throw new Error(
          `Provider returned tx hash ${submittedHash}, but signed body hash is ${txHash}`,
        );
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `Submitting tx [ ${txName} ]: submit attempt ${attempt}/${ADOPTION_ATTEMPTS} returned:`,
        error,
      );
    }

    try {
      console.log(
        "Submitting tx [",
        txName,
        `]: waiting for adoption (attempt ${attempt}/${ADOPTION_ATTEMPTS}) ...`,
      );
      await awaitTxWithTimeout(txHash);
      console.log("Submitting tx [", txName, "]: done");
      return txHash;
    } catch (error) {
      lastError = error;
      console.warn(
        `Submitting tx [ ${txName} ]: tx ${txHash} was not visible on the canonical chain after attempt ${attempt}/${ADOPTION_ATTEMPTS}:`,
        error,
      );
      if (attempt === ADOPTION_ATTEMPTS) {
        throw error;
      }
      await sleep(ADOPTION_RETRY_DELAY_MS);
    }
  }

  throw lastError ?? new Error(`Failed to confirm tx '${txName}'`);
};

export const awaitWalletTx = async (
  lucid: LucidEvolution,
  txHash: string,
  checkInterval = 1000,
  timeoutMs = 30000,
): Promise<void> => {
  const timeoutAt = Date.now() + timeoutMs;
  const kupoUrl = Deno.env.get("KUPO_URL")?.trim();
  const kupoApiKey = Deno.env.get("KUPO_API_KEY")?.trim();
  const managedKupoUrl = kupoUrl
    ? resolveManagedKupoUrl(kupoUrl, kupoApiKey)
    : undefined;
  const kupoMatchHeader = kupoUrl
    ? resolveManagedKupoHeader(kupoUrl, kupoApiKey)
    : undefined;
  const walletAddress = await lucid.wallet().address();
  const kupoRequestVariants = kupoUrl
    ? resolveManagedKupoRequestVariants(kupoUrl, kupoApiKey)
    : [];

  while (Date.now() < timeoutAt) {
    if (managedKupoUrl) {
      const requestVariants = kupoRequestVariants.length > 0
        ? kupoRequestVariants
        : [{
          baseUrl: managedKupoUrl,
          headers: kupoMatchHeader,
        }];

      for (const variant of requestVariants) {
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
        args.push(
          `${variant.baseUrl}/matches/${walletAddress}?unspent`,
          "-w",
          "\n%{http_code}",
        );

        const output = await new Deno.Command("/usr/bin/curl", {
          args,
          stdout: "piped",
          stderr: "piped",
        }).output();

        if (output.success) {
          const stdout = new TextDecoder().decode(output.stdout);
          const separator = stdout.lastIndexOf("\n");
          const body = separator >= 0 ? stdout.slice(0, separator) : stdout;
          const statusText = separator >= 0
            ? stdout.slice(separator + 1).trim()
            : "500";
          const status = Number.parseInt(statusText, 10) || 500;
          if (status >= 200 && status < 300) {
            const matches = JSON.parse(body) as Array<{
              transaction_id?: string;
            }>;
            if (matches.some((match) => match.transaction_id === txHash)) {
              return;
            }
          }
        }
      }
    } else {
      const walletUtxos = await lucid.wallet().getUtxos();
      if (walletUtxos.some((utxo) => utxo.txHash === txHash)) {
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  throw new Error(`Timed out waiting for wallet visibility of tx ${txHash}`);
};

export const formatTimestamp = (timestampInMilliseconds: number): string => {
  const date = new Date(timestampInMilliseconds);

  // Get hours, minutes, day, month, and year
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Months are zero-based
  const year = date.getFullYear();

  // Format the date string as "hh:mm_ddMMyyy"
  const formattedDate = `${hours}${minutes}${day}${month}${year}`;

  return formattedDate;
};

export const generateTokenName = async (
  baseToken: AuthToken,
  prefix: string,
  sequence: bigint,
): Promise<string> => {
  if (sequence < 0) throw new Error("sequence must be unsigned integer");

  const postfix = fromText(sequence.toString());

  if (postfix.length > 16) throw new Error("postfix size > 8 bytes");

  const baseTokenPart = (await hashSha3_256(
    baseToken.policy_id + baseToken.name,
  )).slice(0, 40);

  const prefixPart = (await hashSha3_256(prefix)).slice(0, 8);

  const fullName = baseTokenPart + prefixPart + postfix;

  return fullName;
};

export const hashSha3_256 = async (data: string) => {
  const hexData = fromHex(data);
  const digest = await crypto.subtle.digest(
    "SHA3-256",
    new Uint8Array(hexData),
  );
  return toHex(new Uint8Array(digest));
};

const resolveOgmiosWsUrl = (ogmiosUrl: string) => {
  const websocketUrl = (() => {
    const explicitWsUrl = Deno.env.get("OGMIOS_WS_URL")?.trim();
    if (explicitWsUrl) {
      return explicitWsUrl;
    }

    try {
      const parsedUrl = new URL(ogmiosUrl);
      if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
        return parsedUrl.toString();
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
        return parsedUrl.toString();
      }
    } catch {
      // Fall back to the provided URL if it is already a websocket URL or
      // cannot be parsed into an HTTP/HTTPS transport URL.
    }

    return ogmiosUrl;
  })();

  return websocketUrl;
};

export const querySystemStart = async (ogmiosUrl: string) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const client = new WebSocket(resolveOgmiosWsUrl(ogmiosUrl));
    try {
      const systemStart = await new Promise<string>((res, rej) => {
        let settled = false;
        const timeoutHandle = setTimeout(() => {
          settled = true;
          client.close();
          rej(new Error("Timed out waiting for queryNetwork/startTime response"));
        }, 10000);

        client.onopen = () => {
          client.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "queryNetwork/startTime",
              params: {},
              id: null,
            }),
          );
        };

        client.onmessage = (msg: MessageEvent<string>) => {
          settled = true;
          clearTimeout(timeoutHandle);
          try {
            const { result } = JSON.parse(msg.data);
            res(result);
          } catch (error) {
            rej(error);
          } finally {
            client.close();
          }
        };

        client.onclose = (event) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutHandle);
          rej(
            new Error(
              `WebSocket closed before queryNetwork/startTime returned a response (code=${event.code}, reason=${event.reason})`,
            ),
          );
        };
      });
      const parsedSystemTime = Date.parse(systemStart);
      return parsedSystemTime;
    } catch (error) {
      lastError = error;
      if (attempt >= 5) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw lastError ?? new Error("Failed to query network start time");
};

export const generateIdentifierTokenName = (outRef: OutputReference) => {
  // Note: Aiken's cbor.serialise() produces indefinite-length CBOR arrays,
  // so we must NOT use { canonical: true } here to match the on-chain hash computation.
  const serializedData = Data.to(outRef, OutputReference);
  return hashSha3_256(serializedData);
};

export const getNonceOutRef = async (
  lucid: LucidEvolution,
): Promise<[UTxO, OutputReference]> => {
  const signerUtxos = await getLiveWalletUtxos(lucid);
  if (signerUtxos.length < 1) throw new Error("No UTXO founded");
  const NONCE_UTXO = signerUtxos[0];
  const outputReference: OutputReference = {
    transaction_id: NONCE_UTXO.txHash,
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  return [NONCE_UTXO, outputReference];
};

export const filterLiveUtxos = async (
  lucid: LucidEvolution,
  utxos: UTxO[],
): Promise<UTxO[]> => {
  if (utxos.length === 0) {
    return [];
  }

  // Requery the wallet view and intersect locally instead of relying on
  // utxosByOutRef(), because some managed Kupo providers are inconsistent on
  // wildcard out-ref lookups even when plain wallet-address matches are healthy.
  const currentWalletUtxos = await lucid.wallet().getUtxos();
  if (currentWalletUtxos.length === 0) {
    return [];
  }

  const liveRefs = new Set(
    currentWalletUtxos.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`),
  );
  return utxos.filter((utxo) =>
    liveRefs.has(`${utxo.txHash}#${utxo.outputIndex}`)
  );
};

export const getLiveWalletUtxos = async (
  lucid: LucidEvolution,
  minCount = 1,
  maxAttempts = 12,
  retryDelayMs = 2000,
): Promise<UTxO[]> => {
  let lastLiveUtxos: UTxO[] = [];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const walletUtxos = await lucid.wallet().getUtxos();
      const liveUtxos = await filterLiveUtxos(lucid, walletUtxos);
      if (liveUtxos.length >= minCount) {
        return liveUtxos;
      }
      lastLiveUtxos = liveUtxos;
      lastError = null;
    } catch (error) {
      // Managed preprod providers can intermittently return transient auth or
      // edge failures even when the same wallet query succeeds moments later.
      // Treat those as retryable during bridge bootstrap instead of failing fast.
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  const walletAddress = await lucid.wallet().address();
  if (lastError) {
    throw new Error(
      `Wallet ${walletAddress} UTxO query did not stabilize after ${maxAttempts} attempts: ${String(lastError)}`,
    );
  }
  throw new Error(
    `Wallet ${walletAddress} only has ${lastLiveUtxos.length} live UTxO(s); need ${minCount}.`,
  );
};

type Validator =
  | "spendHandler"
  | "spendClient"
  | "spendConnection"
  | "spendChannel"
  | "spendMockModule"
  | "spendTraceRegistry"
  | "spendTransferModule"
  | "mintIdentifier"
  | "mintVoucher"
  | "verifyProof"
  | "hostStateStt"
  | "mintClientStt"
  | "mintConnectionStt"
  | "mintChannelStt";

type Module = "handler" | "transfer" | "mock" | "icq";

type Tokens = "mock";

export type DeploymentTemplate = {
  deployedAt: string;
  validators: {
    spendHandler: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    spendClient: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    spendConnection: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    spendChannel: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
      refValidator?: Record<
        string,
        { script: string; scriptHash: string; refUtxo: UTxO }
      >;
    };
    spendTransferModule: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    spendMockModule?: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintIdentifier: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    spendTraceRegistry: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintVoucher: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintTraceRegistryBenchmarkVoucher?: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    verifyProof: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    hostStateStt: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintClientStt: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintConnectionStt: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintChannelStt: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
  };
  handlerAuthToken: {
    policyId: string;
    name: string;
  };
  hostStateNFT?: {
    policyId: string;
    name: string;
  };
  traceRegistry?: {
    address: string;
    shardPolicyId: string;
    directory: {
      policyId: string;
      name: string;
    };
  };
  modules: Record<
    Module,
    {
      identifier: string;
      address: string;
    }
  >;
  tokens: Record<Tokens, string>;
};
