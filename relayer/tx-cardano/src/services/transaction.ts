import * as transaction_pb from "../proto/protoc/transaction";
import * as grpc from "@grpc/grpc-js"
import * as keys from "../relayer-config/keys"
import { InitLucidKupmios, InitLucidBlockfrost, InitLucid, GetPrivateKeyDefault } from "../util/common";
import { logger } from "../logger/logger";
import { toHex } from "lucid-cardano";

export class Transaction extends transaction_pb.tx.UnimplementedTransactionServiceService {
    async SignAndSubmitTx(call: grpc.ServerUnaryCall<transaction_pb.tx.SignAndSubmitTxRequest, transaction_pb.tx.SignAndSubmitTxResponse>, callback: grpc.sendUnaryData<transaction_pb.tx.SignAndSubmitTxResponse>) {
        try {
            const chainId = call.request.chain_id
            const tx_hex_str = call.request.transaction_hex_string

            // init lucid
            const lucid = await InitLucid()
            //let initTx = lucid.selectWalletFromPrivateKey(keys.GetPrivateKeyUse(chainId))
            let initTx = lucid.selectWalletFromPrivateKey(GetPrivateKeyDefault())
            
            const tx = initTx.fromTx(toHex(tx_hex_str))
            
            // sign tx
            const signedTx = await tx.sign().complete();
            
            // submit tx
            const tx_id = await signedTx.submit()

            const res =  new transaction_pb.tx.SignAndSubmitTxResponse()
            res.transaction_id = tx_id

            logger.print(`Transaction Service: SignAndSubmit:  tx_id: ${res.transaction_id}`)
            callback(null, res)
            
        } catch (error) {
            console.log(error)
            logger.print(`Transaction Service: SignAndSubmit:  error: ` + error.message)
            callback(error, null)
        }
    }
}