import * as cbor from "https://deno.land/x/cbor@v1.4.1/index.js";
import blueprint from "../plutus.json" with { type: "json" };
import {
  validatorToScriptHash,
  validatorToAddress,
  Address,
  applyParamsToScript,
  Blockfrost,
  Data,
  Emulator,
  Exact,
  fromHex,
  fromText,
  Kupmios,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  Provider,
  Script,
  ScriptHash,
  SLOT_CONFIG_NETWORK,
  toHex,
  TxBuilder,
  UTxO,
} from "npm:@lucid-evolution/lucid@0.3.51";
import {
  BLOCKFROST_ENV,
  EMULATOR_ENV,
  KUPMIOS_ENV,
  LOCAL_ENV,
} from "./constants.ts";
import { createHash } from "https://deno.land/std@0.61.0/hash/mod.ts";
import { AuthToken } from "../lucid-types/ibc/auth/AuthToken.ts";
import { OutputReference } from "../lucid-types/aiken/transaction/OutputReference.ts";

export const readValidator = async <T extends unknown[] = Data[]>(
  title: string,
  lucid?: Lucid,
  params?: Exact<[...T]>,
  type?: T
): Promise<[Script, ScriptHash, Address]> => {
  const rawValidator = blueprint.validators.find((v) => v.title === title);
  if (!rawValidator) {
    throw new Error(`Unable to field validator with title ${title}`);
  }
  const encodedValidator = toHex(
    cbor.encode(fromHex(rawValidator.compiledCode))
  );

  let validator: Script;

  if (params === undefined) {
    validator = {
      type: "PlutusV2",
      script: encodedValidator,
    };
  } else {
    validator = {
      type: "PlutusV2",
      script: applyParamsToScript(encodedValidator, params, type),
    };
  }

  return [validator, validatorToScriptHash(validator), validatorToAddress(lucid.config().network, validator)];
};

export const submitTx = async (
  tx: TxBuilder,
  lucid: Lucid,
  txName: string,
  logSize = true,
  nativeUplc?: boolean
) => {
  console.log("Submitting tx [", txName, "]");
  const completedTx = await tx.complete({ nativeUplc });
  if (logSize) {
    console.log("Submitting tx [", txName, "]: size in bytes", completedTx.toCBOR().length/2);
  }
  console.log("Submitting tx [", txName, "]: signing ...");
  const signedTx = await completedTx.sign.withWallet().complete();
  console.log("Submitting tx [", txName, "]: signed tx size in bytes", signedTx.toCBOR().length/2);
  console.log("Submitting tx [", txName, "]: submitting ...");
  const txHash = await signedTx.submit();
  console.log("Submitting tx [", txName, "]: tx hash is", txHash);
  console.log("Submitting tx [", txName, "]: waiting for adoption ...");
  await lucid.awaitTx(txHash);
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

export type Signer = {
  sk: string;
  address: string;
};

export const setUp = async (
  mode: string
): Promise<{ lucid: Lucid; signer: Signer; provider: Provider }> => {
  const signer = {
    sk: "ed25519_sk1rvgjxs8sddhl46uqtv862s53vu4jf6lnk63rcn7f0qwzyq85wnlqgrsx42",
    address: "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
  };
  let provider: Provider;
  let lucid: Lucid;
  if (mode == EMULATOR_ENV) {
    console.log("Deploy in Emulator env");
    provider = new Emulator(
      [
        { address: signer.address, assets: { lovelace: 3000000000000n } },
        { address: signer.address, assets: { lovelace: 3000000000000n } },
      ],
      { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 900000 }
    );
    lucid = await Lucid(provider, "Preview");
  } else if (mode == KUPMIOS_ENV) {
    const kupo = "http://192.168.10.136:1442";
    const ogmios = "http://192.168.10.136:1337";
    console.log("Deploy in Kupmios", kupo, ogmios);
    provider = new Kupmios(kupo, ogmios);
    const chainZeroTime = await querySystemStart(ogmios);
    SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
    lucid = await Lucid(provider, "Preview");
  } else if (mode == LOCAL_ENV) {
    const kupo = "http://localhost:1442";
    const ogmios = "http://localhost:1337";
    console.log("Deploy in local", kupo, ogmios);
    provider = new Kupmios(kupo, ogmios);

    const chainZeroTime = await querySystemStart(ogmios);
    SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
    lucid = await Lucid(provider, "Custom");
  } else if (mode == BLOCKFROST_ENV) {
    provider = new Blockfrost(
      "https://cardano-preview.blockfrost.io/api/v0",
      "preview2fjKEg2Zh687WPUwB8eljT2Mz2q045GC"
    );
    lucid = await Lucid(provider, "Preview");
  } else {
    throw new Error("Invalid provider type");
  }

  lucid.selectWallet.fromPrivateKey(signer.sk);

  return {
    lucid,
    signer,
    provider,
  };
};

export const generateTokenName = (
  baseToken: AuthToken,
  prefix: string,
  sequence: bigint
): string => {
  if (sequence < 0) throw new Error("sequence must be unsigned integer");

  const postfix = fromText(sequence.toString());

  if (postfix.length > 16) throw new Error("postfix size > 8 bytes");

  const baseTokenPart = hashSha3_256(
    baseToken.policy_id + baseToken.name
  ).slice(0, 40);

  const prefixPart = hashSha3_256(prefix).slice(0, 8);

  const fullName = baseTokenPart + prefixPart + postfix;

  return fullName;
};

export const hashSha3_256 = (data: string) => {
  const sha3Hasher = createHash("sha3-256");
  const hash = sha3Hasher.update(fromHex(data)).toString();
  return hash;
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
    console.log('WebSocket connection closed.', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
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

export const delay = (duration: number) => {
  let elapsedSeconds = 1;

  const logElapsedTime = () => {
    Deno.stdout.writeSync(
      new TextEncoder().encode(`\rElapsed time: ${elapsedSeconds}s`)
    );
    elapsedSeconds++;
  };

  const intervalId = setInterval(logElapsedTime, 1000);

  console.log(`Delay ${duration}s`);

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      clearInterval(intervalId);
      Deno.stdout.writeSync(
        new TextEncoder().encode(`\rElapsed time: ${elapsedSeconds}s`)
      );
      Deno.stdout.writeSync(new TextEncoder().encode(`\r`));
      resolve();
    }, duration * 1000);
  });
};

export const parseClientSequence = (clientId: string): bigint => {
  const fragments = clientId.split("-");

  if (fragments.length < 2) throw new Error("Invalid client id format");

  if (!(fragments.slice(0, -1).join("") === "ibc_client")) {
    throw new Error("Invalid client id format");
  }

  return BigInt(fragments.pop()!);
};

export const parseConnectionSequence = (connectionId: string): bigint => {
  const fragments = connectionId.split("-");

  if (fragments.length != 2) throw new Error("Invalid connection id format");

  if (!(fragments.slice(0, -1).join("") === "connection")) {
    throw new Error("Invalid connection id format");
  }

  return BigInt(fragments.pop()!);
};
export const parseChannelSequence = (channelId: string): bigint => {
  const fragments = channelId.split("-");

  if (fragments.length != 2) throw new Error("Invalid channel id format");

  if (!(fragments.slice(0, -1).join("") === "channel")) {
    throw new Error("Invalid channel id format");
  }

  return BigInt(fragments.pop()!);
};

export const createReferenceScriptUtxo = async (
  lucid: Lucid,
  referredScript: Script
) => {
  const [, , referenceAddress] = readValidator(
    "reference_validator.refer_only",
    lucid
  );

  const tx = lucid.newTx().payToContract(
    referenceAddress,
    {
      inline: Data.void(),
      scriptRef: referredScript,
    },
    {}
  );
  const completedTx = await tx.complete();
  const signedTx = await completedTx.sign().complete();
  const txHash = await signedTx.submit();

  await lucid.awaitTx(txHash);

  const referenceUtxo = (
    await lucid.utxosByOutRef([{ txHash, outputIndex: 0 }])
  )[0];

  return referenceUtxo;
};

export const generateIdentifierTokenName = (outRef: OutputReference) => {
  const serializedData = Data.to(outRef, OutputReference);
  return hashSha3_256(serializedData);
};

export const insertSortMap = <K, V>(
  inputMap: Map<K, V>,
  newKey: K,
  newValue: V,
  keyComparator?: (a: K, b: K) => number
): Map<K, V> => {
  // Convert the Map to an array of key-value pairs
  const entriesArray: [K, V][] = Array.from(inputMap.entries());

  // Add the new key-value pair to the array
  entriesArray.push([newKey, newValue]);

  // Sort the array based on the keys using the provided comparator function
  entriesArray.sort((entry1, entry2) =>
    keyComparator
      ? keyComparator(entry1[0], entry2[0])
      : Number(entry1[0]) - Number(entry2[0])
  );

  // Create a new Map from the sorted array
  const sortedMap = new Map<K, V>(entriesArray);

  return sortedMap;
};

export const deleteSortMap = <K, V>(
  sortedMap: Map<K, V>,
  keyToDelete: K,
  keyComparator?: (a: K, b: K) => number
): Map<K, V> => {
  // Convert the sorted map to an array of key-value pairs
  const entriesArray: [K, V][] = Array.from(sortedMap.entries());

  // Find the index of the key to delete
  const indexToDelete = entriesArray.findIndex(([key]) =>
    keyComparator ? keyComparator(key, keyToDelete) === 0 : key === keyToDelete
  );

  // If the key is found, remove it from the array
  if (indexToDelete !== -1) {
    entriesArray.splice(indexToDelete, 1);
  }

  // Create a new Map from the modified array
  const updatedMap = new Map<K, V>(entriesArray);

  return updatedMap;
};

export const getNonceOutRef = async (
  lucid: Lucid
): Promise<[UTxO, OutputReference]> => {
  const signerUtxos = await lucid.wallet().getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO founded");
  const NONCE_UTXO = signerUtxos[0];
  const outputReference: OutputReference = {
    transaction_id: {
      hash: NONCE_UTXO.txHash,
    },
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  return [NONCE_UTXO, outputReference];
};
