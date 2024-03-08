import * as cbor from "https://deno.land/x/cbor@v1.4.1/index.js";
import blueprint from "../plutus.json" with { type: "json" };
import {
  Blockfrost,
  C,
  Data,
  Emulator,
  fromHex,
  fromText,
  Kupmios,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  Provider,
  Script,
  SLOT_CONFIG_NETWORK,
  toHex,
  Tx,
  TxComplete,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  BLOCKFROST_ENV,
  EMULATOR_ENV,
  KUPMIOS_ENV,
  LOCAL_ENV,
} from "./constants.ts";
import { AuthToken } from "./types/auth_token.ts";
import { createHash } from "https://deno.land/std@0.61.0/hash/mod.ts";
import { OutputReference } from "./types/common/output_reference.ts";

export const readValidator = (title: string) => {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Unable to field validator with title ${title}`);
  }
  return toHex(cbor.encode(fromHex(validator.compiledCode)));
};

export const submitTx = async (
  tx: Tx,
  lucid?: Lucid,
  txName?: string,
  logSize = true,
  nativeUplc?: boolean,
) => {
  if (txName !== undefined) {
    console.log("Submit tx:", txName);
  }
  const completedTx = await tx.complete({ nativeUplc });
  if (logSize) {
    if (txName !== undefined) {
      console.log(txName, "size:", completedTx.txComplete.to_bytes().length);
    } else {
      console.log("Tx size:", completedTx.txComplete.to_bytes().length);
    }
  }
  const signedTx = await completedTx.sign().complete();
  const txHash = await signedTx.submit();
  if (txName !== undefined) {
    console.log(txName, "submitted with hash:", txHash);
  }
  if (lucid !== undefined) {
    await lucid.awaitTx(txHash);
    if (txName !== undefined) {
      console.log(txName, "done!");
    }
  }
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

export const queryUtxoByAuthToken = async (
  lucid: Lucid,
  address: string,
  authTokenUnit: string,
) => {
  const foundUtxos = await lucid.utxosAt(address);
  const utxo = foundUtxos.find((utxo) => authTokenUnit in utxo.assets);
  if (!utxo) {
    throw new Error(
      `Unable to find UTXO with address: ${address} - token: ${authTokenUnit}`,
    );
  }

  return utxo;
};

export const increaseExUnits = (txComplete: TxComplete) => {
  const tx = JSON.parse(txComplete.txComplete.to_json());
  const newRedeemers = tx.witness_set.redeemers.map(
    (red: {
      ex_units: {
        mem: string;
        steps: string;
      };
    }) => ({
      ...red,
      ex_units: {
        mem: ((BigInt(red.ex_units.mem) * 110n) / 100n).toString(),
        steps: ((BigInt(red.ex_units.steps) * 110n) / 100n).toString(),
      },
    }),
  );
  tx.witness_set.redeemers = newRedeemers;
  const newTxJson = JSON.stringify(tx);
  const newTx = C.Transaction.from_json(newTxJson);
  const newTxBytes = toHex(newTx.to_bytes());

  return newTxBytes;
};

export type Signer = {
  sk: string;
  address: string;
};

export const setUp = async (
  mode: string,
): Promise<{ lucid: Lucid; signer: Signer; provider: Provider }> => {
  const signer = {
    sk: "ed25519_sk1rvgjxs8sddhl46uqtv862s53vu4jf6lnk63rcn7f0qwzyq85wnlqgrsx42",
    address: "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
  };
  let provider: Provider;
  if (mode == EMULATOR_ENV) {
    console.log("Deploy in Emulator env");
    provider = new Emulator([
      { address: signer.address, assets: { lovelace: 3000000000000n } },
      { address: signer.address, assets: { lovelace: 3000000000000n } },
    ], { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 30000 });
  } else if (mode == KUPMIOS_ENV) {
    const kupo = "http://192.168.10.136:1442";
    const ogmios = "ws://192.168.10.136:1337";
    console.log("Deploy in Kupmios", kupo, ogmios);
    provider = new Kupmios(kupo, ogmios);
    const chainZeroTime = await querySystemStart(ogmios);
    SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
  } else if (mode == LOCAL_ENV) {
    const kupo = "http://localhost:1442";
    const ogmios = "ws://localhost:1337";
    console.log("Deploy in local", kupo, ogmios);
    provider = new Kupmios(kupo, ogmios);

    const chainZeroTime = await querySystemStart(ogmios);
    SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
  } else if (mode == BLOCKFROST_ENV) {
    provider = new Blockfrost(
      "https://cardano-preview.blockfrost.io/api/v0",
      "preview2fjKEg2Zh687WPUwB8eljT2Mz2q045GC",
    );
  } else {
    throw new Error("Invalid provider type");
  }

  const lucid = await Lucid.new(provider, "Preview");
  lucid.selectWalletFromPrivateKey(signer.sk);

  return {
    lucid,
    signer,
    provider,
  };
};

export const generateTokenName = (
  baseToken: AuthToken,
  prefix: string,
  sequence: bigint,
): string => {
  if (sequence < 0) throw new Error("sequence must be unsigned integer");

  const postfix = fromText(sequence.toString());

  if (postfix.length > 16) throw new Error("postfix size > 8 bytes");

  const baseTokenPart = hashSha3_256(baseToken.policyId + baseToken.name).slice(
    0,
    40,
  );

  const prefixPart = hashSha3_256(prefix).slice(0, 8);

  const fullName = baseTokenPart + prefixPart + postfix;

  return fullName;
};

const hashSha3_256 = (data: string) => {
  const sha3Hasher = createHash("sha3-256");
  const hash = sha3Hasher.update(
    fromHex(data),
  ).toString();
  return hash;
};

const ogmiosWsp = async (
  ogmiosUrl: string,
  methodname: string,
  args: unknown,
) => {
  const client = new WebSocket(ogmiosUrl);
  await new Promise((res) => {
    client.addEventListener("open", () => res(1), {
      once: true,
    });
  });
  client.send(JSON.stringify({
    type: "jsonwsp/request",
    version: "1.0",
    servicename: "ogmios",
    methodname,
    args,
  }));
  return client;
};

export const querySystemStart = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, "Query", {
    query: "systemStart",
  });
  const systemStart = await new Promise<string>((res, rej) => {
    client.addEventListener("message", (msg: MessageEvent<string>) => {
      try {
        const {
          result,
        } = JSON.parse(msg.data);
        res(result);
        client.close();
      } catch (e) {
        rej(e);
      }
    }, {
      once: true,
    });
  });
  const parsedSystemTime = Date.parse(systemStart);

  return parsedSystemTime;
};

export const delay = (duration: number) => {
  let elapsedSeconds = 1;

  const logElapsedTime = () => {
    Deno.stdout.writeSync(
      new TextEncoder().encode(`\rElapsed time: ${elapsedSeconds}s`),
    );
    elapsedSeconds++;
  };

  const intervalId = setInterval(logElapsedTime, 1000);

  console.log(`Delay ${duration}s`);

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      clearInterval(intervalId);
      Deno.stdout.writeSync(
        new TextEncoder().encode(`\rElapsed time: ${elapsedSeconds}s`),
      );
      Deno.stdout.writeSync(
        new TextEncoder().encode(`\r`),
      );
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

export const createReferenceScriptUtxo = async (
  lucid: Lucid,
  referredScript: Script,
) => {
  const referenceScript: Script = {
    type: "PlutusV2",
    script: readValidator("reference_validator.refer_only"),
  };
  const referenceAddress = lucid.utils.validatorToAddress(referenceScript);

  const tx = lucid.newTx().payToContract(referenceAddress, {
    inline: Data.void(),
    scriptRef: referredScript,
  }, {});
  const completedTx = await tx.complete();
  const signedTx = await completedTx.sign().complete();
  const txHash = await signedTx.submit();

  await lucid.awaitTx(txHash);

  const referenceUtxo =
    (await lucid.utxosByOutRef([{ txHash, outputIndex: 0 }]))[0];

  return referenceUtxo;
};

export const generateIdentifierTokenName = (outRef: OutputReference) => {
  const serializedData = Data.to(outRef, OutputReference);
  return hashSha3_256(serializedData);
};

console.log(
  generateIdentifierTokenName({
    transaction_id: { hash: "1234" },
    output_index: 0n,
  }),
);

export const insertSortMap = <K, V>(
  inputMap: Map<K, V>,
  newKey: K,
  newValue: V,
  keyComparator?: (a: K, b: K) => number,
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
