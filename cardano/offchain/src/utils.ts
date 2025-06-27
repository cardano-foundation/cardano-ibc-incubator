import blueprint from "../../onchain/plutus.json" with { type: "json" };
import { crypto } from "@std/crypto";
import {
  validatorToScriptHash,
  validatorToAddress,
  Address,
  applyParamsToScript,
  Data,
  Exact,
  fromHex,
  fromText,
  Script,
  ScriptHash,
  toHex,
  TxBuilder,
  UTxO,
  LucidEvolution,
} from "@lucid-evolution/lucid";
import { AuthToken, OutputReference } from "../types/index.ts";

export const readValidator = <T extends unknown[] = Data[]>(
  title: string,
  lucid: LucidEvolution,
  params?: Exact<[...T]>,
  type?: T
): [Script, ScriptHash, Address] => {
  const rawValidator = blueprint.validators.find((v) => v.title === title);
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

  return [validator, validatorToScriptHash(validator), validatorToAddress(lucid.config().network || 'Custom', validator)];
};

export const submitTx = async (
  tx: TxBuilder,
  lucid: LucidEvolution,
  txName: string,
  logSize = true,
  localUPLCEval?: boolean
) => {
  console.log("Submitting tx [", txName, "]");
  const completedTx = await tx.complete({ localUPLCEval });
  if (logSize) {
    console.log("Submitting tx [", txName, "]: size in bytes", completedTx.toCBOR().length / 2);
  }
  console.log("Submitting tx [", txName, "]: signing ...");
  const signedTx = await completedTx.sign.withWallet().complete();
  console.log("Submitting tx [", txName, "]: signed tx size in bytes", signedTx.toCBOR().length / 2);
  console.log("Submitting tx [", txName, "]: submitting ...");
  const txHash = await signedTx.submit();
  console.log("Submitting tx [", txName, "]: tx hash is", txHash);
  console.log("Submitting tx [", txName, "]: waiting for adoption ...");
  await lucid.awaitTx(txHash, 1000);
  console.log("Submitting tx [", txName, "]: done");
  return txHash;
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
  sequence: bigint
): Promise<string> => {
  if (sequence < 0) throw new Error("sequence must be unsigned integer");

  const postfix = fromText(sequence.toString());

  if (postfix.length > 16) throw new Error("postfix size > 8 bytes");

  const baseTokenPart = (await hashSha3_256(
    baseToken.policy_id + baseToken.name
  )).slice(0, 40);

  const prefixPart = (await hashSha3_256(prefix)).slice(0, 8);

  const fullName = baseTokenPart + prefixPart + postfix;

  return fullName;
};

export const hashSha3_256 = async (data: string) => {
  const digest = await crypto.subtle.digest('SHA3-256', fromHex(data));
  return toHex(new Uint8Array(digest));
};

const ogmiosWsp = async (
  ogmiosUrl: string,
  methodname: string,
  args: unknown
) => {
  const client = new WebSocket(ogmiosUrl);
  await new Promise((res) => {
    client.addEventListener("open", () => res(1), {
      once: true,
    });
  });
  client.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: methodname,
      params: args,
    })
  );
  return client;
};

export const querySystemStart = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, "queryNetwork/startTime", {});

  client.addEventListener('open', () => console.log('WebSocket connection opened.'));
  client.addEventListener('close', (event) => {
    if (!event.wasClean) {
      console.log('WebSocket connection closed.', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    }
  });
  client.addEventListener('error', (err) => console.log('WebSocket error:', err));

  const systemStart = await new Promise<string>((res, rej) => {
    client.addEventListener(
      "message",
      (msg: MessageEvent<string>) => {
        try {
          const { result } = JSON.parse(msg.data);
          res(result);
          client.close();
        } catch (e) {
          rej(e);
        }
      },
      {
        once: true,
      }
    );
  });
  const parsedSystemTime = Date.parse(systemStart);

  return parsedSystemTime;
};

export const generateIdentifierTokenName = (outRef: OutputReference) => {
  const serializedData = Data.to(outRef, OutputReference);
  return hashSha3_256(serializedData);
};

export const getNonceOutRef = async (
  lucid: LucidEvolution
): Promise<[UTxO, OutputReference]> => {
  const signerUtxos = await lucid.wallet().getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO founded");
  const NONCE_UTXO = signerUtxos[0];
  const outputReference: OutputReference = {
    transaction_id: NONCE_UTXO.txHash,
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  return [NONCE_UTXO, outputReference];
};

type Validator =
  | "spendHandler"
  | "mintClient"
  | "spendClient"
  | "mintConnection"
  | "spendConnection"
  | "mintChannel"
  | "spendChannel"
  | "mintPort"
  | "mintIdentifier"
  | "spendTransferModule"
  | "mintVoucher"
  | "verifyProof";

type Module = "handler" | "transfer";

type Tokens = "mock";

export type DeploymentTemplate = {
  validators: Record<
    Validator,
    {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
      refValidator?: Record<
        string,
        { script: string; scriptHash: string; refUtxo: UTxO }
      >;
    }
  >;
  handlerAuthToken: {
    policyId: string;
    name: string;
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
