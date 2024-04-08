import * as transaction_pb from "../proto/protoc/transaction";
import * as grpc from "@grpc/grpc-js"
import * as keys from "../relayer-config/keys"
import { InitLucidKupmios, InitLucidBlockfrost, InitLucid} from "../util/common";
import { logger } from "../logger/logger";
import { toHex } from "lucid-cardano";

export class Transaction extends transaction_pb.tx.UnimplementedTransactionServiceService {
    async SignAndSubmitTx(call: grpc.ServerUnaryCall<transaction_pb.tx.SignAndSubmitTxRequest, transaction_pb.tx.SignAndSubmitTxResponse>, callback: grpc.sendUnaryData<transaction_pb.tx.SignAndSubmitTxResponse>) {
        try {
            const chainId = call.request.chain_id
            const txHexStr = call.request.transaction_hex_string
            
            if(txHexStr.length == 0) {
                throw Error("Transaction Hex String Empty")
            }
            // init lucid
            const lucid = await InitLucid()
            const initTx = lucid.selectWalletFromSeed(keys.GetMnemonicKeyUse(chainId), {addressType:"Enterprise"})
            const tx = initTx.fromTx(toHex(txHexStr))
            // sign tx
            const signedTx = await tx.sign().complete();
            
            // submit tx
            const tx_id = await signedTx.submit()

            // TODO: check timeout
            // wait for transaction to be included in block
            await lucid.awaitTx(tx_id)

            const res =  new transaction_pb.tx.SignAndSubmitTxResponse()
            res.transaction_id = tx_id

            logger.print(`[Transaction Service] [API SignAndSubmit] [Status: Success] [Request: {chain_id: ${chainId}}] [Response: {tx_id: ${res.transaction_id}}]`)
            callback(null, res)
            
        } catch (err) {
            console.log(err)
            logger.print(`[Transaction Service] [API SignAndSubmit] [Status: Error] [Request: {chain_id: ${call.request.chain_id}}]` + " [Error Msg: "+ err + "]")
            callback(null, err)
        }
    }
}