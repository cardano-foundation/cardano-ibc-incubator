import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import {Address, TransactionUnspentOutput,} from "@emurgo/cardano-serialization-lib-browser";
import {Backend} from "../Backend";
import {NetworkName} from "../Network";
import {TxSendError, TxSendErrorCode} from "../ErrorTypes";

function fixUrl(url: string) {
    if (url.startsWith("http://")) return url;
    if (url.startsWith("https://")) return url;
    return "https://" + url;
}

class OgmiosKupoBackend implements Backend {
    kupoUrl: string;
    ogmiosUrl: string;

    constructor({kupoUrl, ogmiosUrl}: { kupoUrl: string, ogmiosUrl: string }) {
        this.kupoUrl = fixUrl(kupoUrl);
        this.ogmiosUrl = fixUrl(ogmiosUrl);
    }

    async getUtxos(address: Address): Promise<TransactionUnspentOutput[]> {
        let matches = await getKupoMatches(this.kupoUrl, address);

        let values: CSL.TransactionUnspentOutput[] = [];
        for (let match of matches) {
            let value = parseValue(match.value);
            const txIn = CSL.TransactionInput.new(
                CSL.TransactionHash.from_hex(match.transaction_id),
                match.output_index,
            );
            const txOut = CSL.TransactionOutput.new(
                CSL.Address.from_bech32(match.address),
                value
            );
            let utxo_ = CSL.TransactionUnspentOutput.new(txIn, txOut);
            values.push(utxo_);
        }
        return values;
    }

    getNetwork(): NetworkName | null {
        return null
    }

    async submitTx(tx: string): Promise<string> {
        let res: OgmiosSubmitTxResp = await fetch(
            this.ogmiosUrl + "/?SubmitTransaction",
            {
                method: "POST",
                headers: {
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "submitTransaction",
                    params: {
                        transaction: {cbor: tx},
                    },
                    id: null,
                }),
            }
        ).then((res) => res.json());
        if (res.result != null) {
            return res.result.transaction.id;
        }

        let errMsg = "";
        if (res.error != null) {
            errMsg = "(" + res.error.code + ") " + res.error.message;
        }
        let err: TxSendError = {
            code: TxSendErrorCode.Failure,
            info: "Failed to send tx using Ogmios: " + errMsg,
        };
        throw err;
    }
}

interface KupoMatch {
    transaction_index: number;
    transaction_id: string;
    output_index: number;
    address: string;
    value: {
        coins: number;
        assets: {
            [policyIdAssetName: string]: number;
        };
    };
    datum_hash: string | null;
    datum_type?: "hash" | "inline";
    script_hash: string | null;
    created_at: {
        slot_no: number;
        header_hash: string;
    };
    spent_at: {
        slot_no: number;
        header_hash: string;
    } | null;
}

interface OgmiosSubmitTxResp {
    jsonrpc: string;
    method: string;
    id?: any;
    result?: {
        transaction: { id: string };
    };
    error?: {
        code: number;
        message: string;
    };
}

async function getKupoMatches(
    url: string,
    address: CSL.Address
): Promise<KupoMatch[]> {
    const addressHex = address.to_hex()
    let queryUrl = `${address.to_bech32()}`
    if (addressHex.length > 58) {
        const paymentCred = addressHex.slice(2, 56 + 2)
        queryUrl = `${paymentCred}/*`
    }

    let res = await fetch(url + "/matches/" + queryUrl + "?unspent");
    let resJson = await res.json();
    return resJson;
}

function parseValue(value: {
    coins: number;
    assets: {
        [policyIdAssetName: string]: number;
    };
}): CSL.Value {
    let cslValue = CSL.Value.new(CSL.BigNum.from_str(value.coins.toString()));
    let multiasset = CSL.MultiAsset.new();
    for (let [policyIdAssetName, amount] of Object.entries(value.assets)) {
        // policyId is always 28 bytes, which when hex encoded is 56 characters.
        let policyId = policyIdAssetName.slice(0, 56);
        // skip the dot at 56
        let assetName = policyIdAssetName.slice(57);

        let policyIdWasm = CSL.ScriptHash.from_hex(policyId);
        let assetNameWasm = CSL.AssetName.from_json('"' + assetName + '"');

        multiasset.set_asset(
            policyIdWasm,
            assetNameWasm,
            CSL.BigNum.from_str(amount.toString()),
        );
    }
    cslValue.set_multiasset(multiasset);
    return cslValue;
}

export {OgmiosKupoBackend};
