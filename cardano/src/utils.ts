import * as cbor from "https://deno.land/x/cbor@v1.4.1/index.js";
import blueprint from "../plutus.json" with { type: "json" };
import {
  Blockfrost,
  C,
  Emulator,
  fromHex,
  Kupmios,
  Lucid,
  Provider,
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

export const readValidator = (title: string) => {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Unable to field validator with title ${title}`);
  }
  return toHex(cbor.encode(fromHex(validator.compiledCode)));
};

export const submitTx = async (tx: Tx, nativeUplc?: boolean) => {
  const completedTx = await tx.complete({ nativeUplc });
  const signedTx = await completedTx.sign().complete();
  const txHash = await signedTx.submit();
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

export const setUp = async (mode: string) => {
  const signer = {
    sk: "ed25519_sk1rvgjxs8sddhl46uqtv862s53vu4jf6lnk63rcn7f0qwzyq85wnlqgrsx42",
    address: "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
  };
  let provider: Provider;
  if (mode == EMULATOR_ENV) {
    console.log("Deploy in Emulator env");
    provider = new Emulator([
      { address: signer.address, assets: { lovelace: 3000000000n } },
    ]);
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
  };
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
