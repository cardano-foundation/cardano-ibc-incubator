import * as CIP30 from "..";
import * as CSL from "@emurgo/cardano-serialization-lib-browser";

class BlockFrostBackend implements CIP30.Backend {
  projectId: string;
  url: string;

  constructor(projectId: string, url?: string) {
    this.projectId = projectId;
    if (url != null) {
      url = url.trim();
    }
    this.url = url || urlFromProjectId(projectId)
  }

  static getNetworkNameFromProjectId(
    projectId: string,
  ): CIP30.NetworkName | null {
    if (projectId.startsWith("mainnet")) {
      return CIP30.NetworkName.Mainnet;
    } else if (projectId.startsWith("preview")) {
      return CIP30.NetworkName.Preview;
    } else if (projectId.startsWith("preprod")) {
      return CIP30.NetworkName.Preprod;
    } else {
      return null;
    }
  }

  async getUtxos(
    address: CSL.Address,
  ): Promise<CSL.TransactionUnspentOutput[]> {
    let utxos = await addressesUtxosAll(this.url, this.projectId, address.to_bech32());
    let values: CSL.TransactionUnspentOutput[] = [];
    for (let utxo of utxos) {
      let value = amountToValue(utxo.amount);
      const txIn = CSL.TransactionInput.new(
        CSL.TransactionHash.from_hex(utxo.tx_hash),
        utxo.output_index,
      );
      const txOut = CSL.TransactionOutput.new(
        CSL.Address.from_bech32(utxo.address),
        value,
      );
      let utxo_ = CSL.TransactionUnspentOutput.new(txIn, txOut);
      values.push(utxo_);
    }
    return values;
  }

  async submitTx(tx: string): Promise<string> {
    return await txSubmit(this.url, this.projectId, tx);
  }
}

function amountToValue(
  amount: {
    unit: string;
    quantity: string;
  }[],
): CSL.Value {
  let value = CSL.Value.new(CSL.BigNum.zero());
  let multiasset = CSL.MultiAsset.new();
  for (let item of amount) {
    if (item.unit.toLowerCase() == "lovelace") {
      value.set_coin(CSL.BigNum.from_str(item.quantity));
      continue;
    }

    // policyId is always 28 bytes, which when hex encoded is 56 characters.
    let policyId = item.unit.slice(0, 56);
    let assetName = item.unit.slice(56);

    let policyIdWasm = CSL.ScriptHash.from_hex(policyId);
    let assetNameWasm = CSL.AssetName.from_json('"' + assetName + '"');

    multiasset.set_asset(
      policyIdWasm,
      assetNameWasm,
      CSL.BigNum.from_str(item.quantity),
    );
  }
  value.set_multiasset(multiasset);
  return value;
}

interface AddressUtxosResponseItem {
  address: string;
  tx_hash: string;
  output_index: number;
  amount: {
    unit: string;
    quantity: string;
  }[];
  block: string;
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
}

type AddressUtxosResponse = AddressUtxosResponseItem[];

async function addressesUtxos(
  baseUrl: string,
  projectId: string,
  address: string,
  params: { page: number; count: number; order: "asc" | "desc" },
): Promise<AddressUtxosResponse | null> {
  let url = new URL(
    baseUrl + "/api/v0/addresses/" + address + "/utxos",
  );
  url.searchParams.append("page", params.page.toString());
  url.searchParams.append("count", params.count.toString());
  url.searchParams.append("order", params.order);

  let resp = await fetch(url, {
    method: "GET",
    headers: { project_id: projectId },
  });
  if (resp.status != 200) {
    if (resp.status == 404) {
      return null;
    }
    let text = await resp.text();
    throw new Error("Request failed: " + url.toString() + "\nMessage: " + text);
  }
  return await resp.json();
}

async function addressesUtxosAll(
  baseUrl: string,
  projectId: string,
  address: string,
): Promise<AddressUtxosResponse> {
  let result = [];
  let page = 1;
  let count = 100;
  let order = "asc" as const;
  while (true) {
    let resp = await addressesUtxos(baseUrl, projectId, address, { page, count, order });
    if (resp == null) break;
    result.push(...resp);
    if (resp.length < count) break;
    page += 1;
  }
  return result;
}

type SubmitTxResponse = string;

async function txSubmit(baseUrl: string, projectId: string, tx: string): Promise<SubmitTxResponse> {
  let txBinary = Buffer.from(tx, "hex");

  let url = new URL(baseUrl + "/api/v0/tx/submit");
  let resp = await fetch(url, {
    method: "POST",
    headers: { project_id: projectId, "Content-Type": "application/cbor" },
    body: txBinary,
  });
  if (resp.status != 200) {
    let text = await resp.text();
    throw new Error("Request failed: " + url.toString() + "\nMessage: " + text);
  }
  return await resp.json();
}

function urlFromProjectId(projectId: string) {
  let prefix = "";
  if (projectId.startsWith("mainnet")) {
    prefix = "mainnet";
  } else if (projectId.startsWith("preview")) {
    prefix = "preview";
  } else if (projectId.startsWith("preprod")) {
    prefix = "preprod";
  } else {
    throw new Error("Invalid project id: " + projectId);
  }

  return "https://cardano-" + prefix + ".blockfrost.io";
}

export { BlockFrostBackend };
