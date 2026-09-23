import blueprint from "../../onchain/plutus.json" with { type: "json" };
import { crypto } from "@std/crypto";
import { blake2b } from "@noble/hashes/blake2b";
import {
  resolveManagedKupoHeader,
  resolveManagedKupoRequestVariants,
  resolveManagedKupoUrl,
} from "./http_auth.ts";
import { queryOgmiosJsonRpc } from "./external_cardano.ts";
import {
  Address,
  applyParamsToScript,
  CML,
  coreToUtxo,
  Data,
  Exact,
  fromHex,
  fromText,
  LucidEvolution,
  Script,
  ScriptHash,
  toHex,
  TxBuilder,
  type TxSigned,
  UTxO,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { AuthToken, OutputReference } from "../types/index.ts";

export const PORT_TOKEN_DOMAIN = "cardano-ibc/port-token/v1";

/** Derive the capability-token name from hex-encoded UTF-8 port bytes using Aiken's exact preimage. */
export const generatePortTokenName = (portId: string): string => {
  const domain = fromHex(fromText(PORT_TOKEN_DOMAIN));
  const id = fromHex(portId);
  const preimage = new Uint8Array(domain.length + 1 + id.length);
  preimage.set(domain);
  preimage[domain.length] = 0;
  preimage.set(id, domain.length + 1);
  return toHex(blake2b(preimage, { dkLen: 32 }));
};

const RETRYABLE_OGMIOS_TRANSPORT_MARKERS = [
  "WebSocket closed before evaluateTransaction returned a response",
  "Timed out waiting for evaluateTransaction response",
  "WebSocket closed before submitTransaction returned a response",
  "Timed out waiting for submitTransaction response",
  "Unexpected server response: 401",
];

const DEFAULT_MAX_TX_SIZE = 16_384;
const TX_SIZE_WARNING_HEADROOM_BYTES = 750;
const WALLET_UTXO_OGMIOS_BATCH_SIZE = 50;
const DEFAULT_DEPLOYMENT_COST_REPORT_PATH =
  "./deployments/deployment-cost-report.json";

type DeploymentCostTx = {
  txName: string;
  txHash: string;
  feeLovelace: string;
  unsignedSizeBytes?: number;
  signedSizeBytes: number;
  outputCount: number;
  totalOutputLovelace: string;
  nonWalletOutputLovelace: string;
  referenceScriptOutputLovelace: string;
  observedAt: string;
};

type DeploymentCostReport = {
  generatedAt: string;
  updatedAt: string;
  mode?: string;
  networkMagic?: string;
  deployerAddress: string;
  txCount: number;
  totalFeesLovelace: string;
  totalOutputLovelace: string;
  totalNonWalletOutputLovelace: string;
  totalReferenceScriptOutputLovelace: string;
  transactions: DeploymentCostTx[];
};

type TxCostSource = {
  toTransaction: () => {
    body: () => {
      fee: () => bigint;
      outputs: () => {
        len: () => number;
        get: (index: number) => {
          address: () => { to_bech32: () => string };
          amount: () => { coin: () => bigint };
          script_ref: () => unknown | undefined;
        };
      };
    };
  };
};

export const isRetryableOgmiosTransportError = (error: unknown): boolean => {
  const errorText = error instanceof Error
    ? `${error.message}\n${error.stack ?? ""}`
    : String(error);

  return RETRYABLE_OGMIOS_TRANSPORT_MARKERS.some((marker) =>
    errorText.includes(marker)
  );
};

const deploymentCostReportPath = (): string =>
  Deno.env.get("DEPLOYMENT_COST_REPORT_PATH")?.trim() ||
  DEFAULT_DEPLOYMENT_COST_REPORT_PATH;

const ensureReportParentDir = async (filePath: string): Promise<void> => {
  const separatorIndex = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  if (separatorIndex <= 0) return;
  await Deno.mkdir(filePath.slice(0, separatorIndex), { recursive: true });
};

const sumDeploymentCostReport = (transactions: DeploymentCostTx[]) => ({
  txCount: transactions.length,
  totalFeesLovelace: transactions
    .reduce((sum, tx) => sum + BigInt(tx.feeLovelace), 0n)
    .toString(),
  totalOutputLovelace: transactions
    .reduce((sum, tx) => sum + BigInt(tx.totalOutputLovelace), 0n)
    .toString(),
  totalNonWalletOutputLovelace: transactions
    .reduce((sum, tx) => sum + BigInt(tx.nonWalletOutputLovelace), 0n)
    .toString(),
  totalReferenceScriptOutputLovelace: transactions
    .reduce((sum, tx) => sum + BigInt(tx.referenceScriptOutputLovelace), 0n)
    .toString(),
});

export const resetDeploymentCostReport = async (
  deployerAddress: string,
  mode?: string,
  networkMagic?: string,
): Promise<void> => {
  try {
    const now = new Date().toISOString();
    const report: DeploymentCostReport = {
      generatedAt: now,
      updatedAt: now,
      mode,
      networkMagic,
      deployerAddress,
      ...sumDeploymentCostReport([]),
      transactions: [],
    };
    const filePath = deploymentCostReportPath();
    await ensureReportParentDir(filePath);
    await Deno.writeTextFile(filePath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.warn("Could not initialize deployment cost report:", error);
  }
};

export const recordDeploymentTx = async (
  txName: string,
  txHash: string,
  tx: TxCostSource,
  walletAddress: string,
  signedSizeBytes: number,
  unsignedSizeBytes?: number,
): Promise<void> => {
  const filePath = deploymentCostReportPath();
  try {
    const reportText = await Deno.readTextFile(filePath).catch((error) => {
      if (error instanceof Deno.errors.NotFound) {
        return undefined;
      }
      throw error;
    });
    if (!reportText) return;

    const body = tx.toTransaction().body();
    const outputs = body.outputs();
    let totalOutputLovelace = 0n;
    let nonWalletOutputLovelace = 0n;
    let referenceScriptOutputLovelace = 0n;
    for (let index = 0; index < outputs.len(); index++) {
      const output = outputs.get(index);
      const lovelace = output.amount().coin();
      totalOutputLovelace += lovelace;
      if (output.address().to_bech32() !== walletAddress) {
        nonWalletOutputLovelace += lovelace;
      }
      if (output.script_ref()) {
        referenceScriptOutputLovelace += lovelace;
      }
    }

    const report = JSON.parse(reportText) as DeploymentCostReport;
    const transactions = [
      ...report.transactions.filter((entry) => entry.txHash !== txHash),
      {
        txName,
        txHash,
        feeLovelace: body.fee().toString(),
        unsignedSizeBytes,
        signedSizeBytes,
        outputCount: outputs.len(),
        totalOutputLovelace: totalOutputLovelace.toString(),
        nonWalletOutputLovelace: nonWalletOutputLovelace.toString(),
        referenceScriptOutputLovelace: referenceScriptOutputLovelace
          .toString(),
        observedAt: new Date().toISOString(),
      },
    ];
    const nextReport: DeploymentCostReport = {
      ...report,
      updatedAt: new Date().toISOString(),
      ...sumDeploymentCostReport(transactions),
      transactions,
    };
    await Deno.writeTextFile(
      filePath,
      `${JSON.stringify(nextReport, null, 2)}\n`,
    );
  } catch (error) {
    console.warn(`Could not record deployment tx cost for ${txName}:`, error);
  }
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

type CompleteOptions = NonNullable<Parameters<TxBuilder["complete"]>[0]>;

/** A balanced, signed deployment transaction that has not been submitted yet. */
export type SignedDeploymentTx = {
  txName: string;
  txHash: string;
  signedTx: TxSigned;
  signedTxBytes: number;
  completedTxBytes?: number;
};

const TX_ADOPTION_ATTEMPTS = 6;
const TX_ADOPTION_TIMEOUT_MS = 30000;
const TX_ADOPTION_RETRY_DELAY_MS = 5000;
const TX_COMPLETE_ATTEMPTS = 5;
// Keep an independent batch within one block body (90,112 bytes on public
// networks). The node mempool holds about two blocks, and a full mempool blocks
// submission instead of rejecting it.
export const DEFAULT_MAX_IN_FLIGHT_TX_BYTES = 80_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Balance, size-check and sign a transaction without submitting it. */
export const completeAndSignTx = async (
  tx: TxBuilder | (() => TxBuilder | Promise<TxBuilder>),
  lucid: LucidEvolution,
  txName: string,
  logSize = true,
  completeOptions: CompleteOptions = { localUPLCEval: false },
): Promise<SignedDeploymentTx> => {
  console.log("Submitting tx [", txName, "]");
  const buildTx = async () => typeof tx === "function" ? await tx() : tx;
  let completedTx;
  let lastCompletionError: unknown = null;
  for (let attempt = 1; attempt <= TX_COMPLETE_ATTEMPTS; attempt += 1) {
    try {
      // Rebuild the transaction from scratch on each completion retry. Lucid's
      // TxBuilder is stateful, so reusing the same builder after a transient
      // Ogmios failure can duplicate mint entries or other accumulated effects.
      completedTx = await (await buildTx()).complete(completeOptions);
      lastCompletionError = null;
      break;
    } catch (error) {
      lastCompletionError = error;
      if (
        !isRetryableOgmiosTransportError(error) ||
        attempt === TX_COMPLETE_ATTEMPTS
      ) {
        throw error;
      }
      console.warn(
        `Submitting tx [ ${txName} ]: complete retry ${attempt}/${TX_COMPLETE_ATTEMPTS} after transient Ogmios transport error:`,
        error,
      );
      await sleep(2000);
    }
  }
  if (!completedTx) {
    throw lastCompletionError ?? new Error(`Failed to complete tx '${txName}'`);
  }
  const maxTxSize = lucid.config().protocolParameters?.maxTxSize ??
    DEFAULT_MAX_TX_SIZE;
  const completedTxBytes = completedTx.toCBOR().length / 2;
  if (completedTxBytes > maxTxSize) {
    throw new Error(
      `Transaction '${txName}' is ${completedTxBytes} bytes before signing, above maxTxSize ${maxTxSize}. Refusing to submit an oversized transaction.`,
    );
  }
  if (completedTxBytes > maxTxSize - TX_SIZE_WARNING_HEADROOM_BYTES) {
    console.warn(
      `Submitting tx [ ${txName} ]: unsigned size ${completedTxBytes} bytes is within ${TX_SIZE_WARNING_HEADROOM_BYTES} bytes of maxTxSize ${maxTxSize}`,
    );
  }
  if (logSize) {
    console.log(
      "Submitting tx [",
      txName,
      "]: size in bytes",
      completedTxBytes,
    );
  }
  console.log("Submitting tx [", txName, "]: signing ...");
  const signedTx = await completedTx.sign.withWallet().complete();
  const signedTxBytes = signedTx.toCBOR().length / 2;
  if (signedTxBytes > maxTxSize) {
    throw new Error(
      `Transaction '${txName}' is ${signedTxBytes} bytes after signing, above maxTxSize ${maxTxSize}. Refusing to submit an oversized transaction.`,
    );
  }
  if (signedTxBytes > maxTxSize - TX_SIZE_WARNING_HEADROOM_BYTES) {
    console.warn(
      `Submitting tx [ ${txName} ]: signed size ${signedTxBytes} bytes is within ${TX_SIZE_WARNING_HEADROOM_BYTES} bytes of maxTxSize ${maxTxSize}`,
    );
  }
  console.log(
    "Submitting tx [",
    txName,
    "]: signed tx size in bytes",
    signedTxBytes,
  );
  // Treat the signed body hash as the canonical tx identity up front. A submit
  // attempt can succeed on-chain even when Ogmios drops the response before
  // returning the transaction id, so retries must not depend on recovering the
  // hash from the transport response.
  const txHash = signedTx.toHash();
  console.log("Submitting tx [", txName, "]: tx hash is", txHash);
  return { txName, txHash, signedTx, signedTxBytes, completedTxBytes };
};

const trySubmitSignedTx = async (
  tx: SignedDeploymentTx,
  attempt: number,
): Promise<unknown> => {
  try {
    console.log(
      "Submitting tx [",
      tx.txName,
      `]: submitting (attempt ${attempt}/${TX_ADOPTION_ATTEMPTS}) ...`,
    );
    const submittedHash = await tx.signedTx.submit();
    if (submittedHash !== tx.txHash) {
      throw new Error(
        `Provider returned tx hash ${submittedHash}, but signed body hash is ${tx.txHash}`,
      );
    }
    return null;
  } catch (error) {
    console.warn(
      `Submitting tx [ ${tx.txName} ]: submit attempt ${attempt}/${TX_ADOPTION_ATTEMPTS} returned:`,
      error,
    );
    return error;
  }
};

/**
 * Wait until a signed transaction is on the canonical chain, resubmitting the
 * same body after each adoption timeout. The first submission is skipped when
 * the caller has already sent it.
 */
const confirmSignedTx = async (
  lucid: LucidEvolution,
  tx: SignedDeploymentTx,
  alreadySubmitted: boolean,
  adoptionTimeoutMs = TX_ADOPTION_TIMEOUT_MS,
): Promise<string> => {
  const walletAddress = await lucid.wallet().address();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= TX_ADOPTION_ATTEMPTS; attempt++) {
    if (attempt > 1 || !alreadySubmitted) {
      lastError = await trySubmitSignedTx(tx, attempt) ?? lastError;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      console.log(
        "Submitting tx [",
        tx.txName,
        `]: waiting for adoption (attempt ${attempt}/${TX_ADOPTION_ATTEMPTS}) ...`,
      );
      await Promise.race([
        awaitWalletTx(lucid, tx.txHash, 1000, adoptionTimeoutMs),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Timed out waiting ${adoptionTimeoutMs}ms for tx adoption`,
                ),
              ),
            adoptionTimeoutMs,
          );
        }),
      ]);
      await recordDeploymentTx(
        tx.txName,
        tx.txHash,
        tx.signedTx,
        walletAddress,
        tx.signedTxBytes,
        tx.completedTxBytes,
      );
      console.log("Submitting tx [", tx.txName, "]: done");
      return tx.txHash;
    } catch (error) {
      lastError = error;
      console.warn(
        `Submitting tx [ ${tx.txName} ]: tx ${tx.txHash} was not visible on the canonical chain after attempt ${attempt}/${TX_ADOPTION_ATTEMPTS}:`,
        error,
      );
      if (attempt === TX_ADOPTION_ATTEMPTS) {
        throw error;
      }
      await sleep(TX_ADOPTION_RETRY_DELAY_MS);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Failed to confirm tx '${tx.txName}'`);
};

export const submitTx = async (
  tx: TxBuilder | (() => TxBuilder | Promise<TxBuilder>),
  lucid: LucidEvolution,
  txName: string,
  logSize = true,
  localUPLCEval = false, // Default to false to use Ogmios for script evaluation
  beforeSubmit?: (signedTx: TxSigned) => void | Promise<void>,
) => {
  const signed = await completeAndSignTx(tx, lucid, txName, logSize, {
    localUPLCEval,
  });
  // Preflight may depend on this exact body hash (for nonce output parameters).
  // It must complete before the first submission attempt.
  await beforeSubmit?.(signed.signedTx);
  return await confirmSignedTx(lucid, signed, false);
};

/** Reject a batch in which two transactions would spend the same output. */
export const assertDisjointTxInputs = (txs: SignedDeploymentTx[]): void => {
  const spentBy = new Map<string, string>();
  for (const tx of txs) {
    const inputs = tx.signedTx.toTransaction().body().inputs();
    for (let index = 0; index < inputs.len(); index++) {
      const input = inputs.get(index);
      const ref = `${input.transaction_id().to_hex()}#${input.index()}`;
      const other = spentBy.get(ref);
      if (other) {
        throw new Error(
          `Batched transactions '${other}' and '${tx.txName}' both spend ${ref}.`,
        );
      }
      spentBy.set(ref, tx.txName);
    }
  }
};

/**
 * Submit signed transactions back to back, then wait for all of them, so they
 * can be adopted in the same block instead of one block each.
 *
 * The list must be in dependency order: a transaction may spend outputs of an
 * earlier one in the list (the node mempool accepts it once the parent is
 * there), but no two transactions may spend the same input. Each transaction is
 * confirmed in order with the resubmission behaviour of submitTx, so a child
 * whose first submission raced its parent is resubmitted after the parent lands.
 * Transactions are sent in waves that fit one block body, so a parent is always
 * in the same or an earlier wave than its children.
 */
export const submitTxBatch = async (
  lucid: LucidEvolution,
  txs: SignedDeploymentTx[],
  options: { maxInFlightBytes?: number; adoptionTimeoutMs?: number } = {},
): Promise<string[]> => {
  assertDisjointTxInputs(txs);
  const maxInFlightBytes = options.maxInFlightBytes ??
    DEFAULT_MAX_IN_FLIGHT_TX_BYTES;
  const waves: SignedDeploymentTx[][] = [];
  let waveBytes = 0;
  for (const tx of txs) {
    const wave = waves.at(-1);
    if (!wave || waveBytes + tx.signedTxBytes > maxInFlightBytes) {
      waves.push([tx]);
      waveBytes = tx.signedTxBytes;
    } else {
      wave.push(tx);
      waveBytes += tx.signedTxBytes;
    }
  }

  const hashes: string[] = [];
  for (const wave of waves) {
    console.log(
      `Submitting ${wave.length} batched transaction(s):`,
      wave.map(({ txName }) => txName).join(", "),
    );
    for (const tx of wave) {
      await trySubmitSignedTx(tx, 1);
    }
    // Confirm every transaction before reporting a failure so adopted ones are
    // still recorded in the deployment cost report.
    let firstError: unknown = undefined;
    for (const tx of wave) {
      try {
        hashes.push(
          await confirmSignedTx(lucid, tx, true, options.adoptionTimeoutMs),
        );
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
  return hashes;
};

/** The outputs a signed transaction will create, before it is submitted. */
export const signedTxOutputs = (signedTx: TxSigned): UTxO[] => {
  const outputs = signedTx.toTransaction().body().outputs();
  const hash = CML.TransactionHash.from_hex(signedTx.toHash());
  const utxos: UTxO[] = [];
  for (let index = 0; index < outputs.len(); index++) {
    utxos.push(coreToUtxo(
      CML.TransactionUnspentOutput.new(
        CML.TransactionInput.new(hash, BigInt(index)),
        outputs.get(index),
      ),
    ));
  }
  return utxos;
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
        const matchPredicates = [`*@${txHash}`, walletAddress];
        for (const predicate of matchPredicates) {
          const output = await new Deno.Command("/usr/bin/curl", {
            args: [
              ...args,
              `${variant.baseUrl}/matches/${predicate}?unspent`,
              "-w",
              "\n%{http_code}",
            ],
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
      }
    } else {
      const walletUtxos = await lucid.wallet().getUtxos();
      if (walletUtxos.some((utxo) => utxo.txHash === txHash)) {
        return;
      }
      // Reference-only transactions may have no wallet change.
      if (
        (await lucid.utxosByOutRef([{ txHash, outputIndex: 0 }])).length > 0
      ) {
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
          rej(
            new Error("Timed out waiting for queryNetwork/startTime response"),
          );
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
  const kupoVisibleUtxos = utxos.filter((utxo) =>
    liveRefs.has(`${utxo.txHash}#${utxo.outputIndex}`)
  );
  return await filterNodeVisibleWalletUtxos(kupoVisibleUtxos);
};

const utxoRefKey = (utxo: UTxO): string => `${utxo.txHash}#${utxo.outputIndex}`;

const filterNodeVisibleWalletUtxos = async (utxos: UTxO[]): Promise<UTxO[]> => {
  const ogmiosUrl = Deno.env.get("OGMIOS_URL")?.trim();
  if (!ogmiosUrl || utxos.length === 0) {
    return utxos;
  }

  const visibleRefs = new Set<string>();
  for (
    let index = 0;
    index < utxos.length;
    index += WALLET_UTXO_OGMIOS_BATCH_SIZE
  ) {
    const batch = utxos.slice(index, index + WALLET_UTXO_OGMIOS_BATCH_SIZE);
    const { result } = await queryOgmiosJsonRpc(
      ogmiosUrl,
      "queryLedgerState/utxo",
      {
        outputReferences: batch.map((utxo) => ({
          transaction: { id: utxo.txHash },
          index: utxo.outputIndex,
        })),
      },
      20_000,
      3,
    );

    for (const output of result ?? []) {
      const txId = output?.transaction?.id;
      const outputIndex = output?.index;
      if (txId !== undefined && outputIndex !== undefined) {
        visibleRefs.add(`${txId}#${outputIndex}`);
      }
    }
  }

  return utxos.filter((utxo) => visibleRefs.has(utxoRefKey(utxo)));
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
      `Wallet ${walletAddress} UTxO query did not stabilize after ${maxAttempts} attempts: ${
        String(lastError)
      }`,
    );
  }
  throw new Error(
    `Wallet ${walletAddress} only has ${lastLiveUtxos.length} live UTxO(s); need ${minCount}.`,
  );
};

type Validator =
  | "recoverClient"
  | "spendClient"
  | "spendTendermintUpdateSession"
  | "mintTendermintUpdateSession"
  | "spendConnection"
  | "spendChannel"
  | "spendMockModule"
  | "spendTraceRegistry"
  | "spendTransferModule"
  | "mintIdentifier"
  | "mintTransferEscrowShard"
  | "mintVoucher"
  | "mintPort"
  | "voucherMetadata"
  | "verifyProof"
  | "hostStateStt"
  | "mintClientStt"
  | "mintConnectionStt"
  | "mintChannelStt";

type Module = "transfer" | "mock" | "icq";

type Tokens = "mock";

export type DeploymentTemplate = {
  clientRegistrations?: import("./client-registry.ts").ClientRegistration[];
  history:
    import("../../../packages/cardano-ibc-tx-builder-runtime/src/historyBootstrap.ts").HistoryBootstrap;
  deployedAt: string;
  consensusHistoryFormat: "proof-backed-v1";
  ics20PacketCodec: "ics20-classic-json-v1";
  validators: {
    recoverClient?: {
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
    spendTendermintUpdateSession: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintTendermintUpdateSession: {
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
    mintTransferEscrowShard: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    mintPort: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    };
    voucherMetadata?: {
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
  hostStateNFT?: {
    policyId: string;
    name: string;
    script?: string;
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
