import { ServerUnaryCall, sendUnaryData } from "@grpc/grpc-js";
import * as key_pb from "../proto/protoc/key";
import * as chains from "../relayer-config/chains";
import * as keys from "../relayer-config/keys";
import { logger } from "../logger/logger";

export class Key extends key_pb.key.UnimplementedKeyServiceService {

    async AddKey(call: ServerUnaryCall<key_pb.key.AddKeyRequest, key_pb.key.Address>, callback: sendUnaryData<key_pb.key.Address>) {
        try {
            
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }
            // check name exits
            if(keys.KeyExist(chainId, keyName)) {
                throw Error("Name already exists")
            }
            
            // create key
            const address = await keys.GenerateKey(chainId, keyName)
            const res = new key_pb.key.Address({
                address: address
            })

            logger.print(`Key Service: API AddKey: Add new key successfully with chain id: ${chainId} , name: ${keyName} address ${address}`)
            callback(null, res)

        } catch (err) {
            logger.print(`Key Service: API AddKey:  Error: ${err.toString()}`)
            callback(err, null)
            
        }
    }

    async ShowAddress(call: ServerUnaryCall<key_pb.key.ShowAddressRequest, key_pb.key.Address>, callback: sendUnaryData<key_pb.key.Address>) {
        try {
            
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }
            // check name exist
            if(!keys.KeyExist(chainId, keyName)) {
                throw Error("Key Name not exist")
            }

            const key = await keys.GetKey(chainId, keyName)

            const res = new key_pb.key.Address({
                address: key['ADDRESS']
            })

            logger.print(`Key Service: API ShowAddress: address: ${key['ADDRESS']}`)
            callback(null, res)
            
        } catch (err) {
            logger.print(`Key Service: API ShowAddress: Error: ${err.toString()}`)
            callback(err, null);
        }
    }

    async DeleteKey(call: ServerUnaryCall<key_pb.key.DeleteKeyRequest, key_pb.key.Empty>, callback: sendUnaryData<key_pb.key.Empty> ){
        try {
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }
            // check name exist
            if(!keys.KeyExist(chainId, keyName)) {
                throw Error("Key Name not exist")
            }
            // delete key
            await keys.DeleteKey(chainId, keyName)

            const res = new key_pb.key.Empty

            logger.print(`Key Service: API DeleteKey: Success chain name: ${chainId}  key name: ${keyName}`)
            callback(null, res)

        } catch (err) {
            logger.print(`Key Service: API DeleteKey: Error: ${err.toString()}`)
            callback(err, null);
        }
    }

    KeyExist(call: ServerUnaryCall<key_pb.key.KeyExistRequest, key_pb.key.KeyExistResponse>, callback: sendUnaryData<key_pb.key.KeyExistResponse>){
        try {
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }

            const exist = keys.KeyExist(chainId, keyName)

            const res = new key_pb.key.KeyExistResponse({
                exist: exist
            })
            logger.print(`Key Service: API KeyExits: ${exist}, ${chainId}, ${keyName}`)
            
            callback(null, res)
        } catch (err) {
            logger.print(`Key Service: API KeyExits: Error: ${err.toString()}`)
            callback(err, null);
        }
    }

    async ListAddresses(call: ServerUnaryCall<key_pb.key.ListAddressesRequest, key_pb.key.ListAddressesResponse>, callback: sendUnaryData<key_pb.key.ListAddressesResponse>) {
        try {
            const chainId = call.request.chain_id
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }

            const listKey = await keys.GetListKey(chainId)

            const listAddresses: key_pb.key.AddressInfo[] = [];
            listKey.forEach(key => {
                const keyInfo = new key_pb.key.AddressInfo({
                    key_name: key["NAME"],
                    address: key["ADDRESS"]
                })
                listAddresses.push(keyInfo)
            })
            
            const res = new key_pb.key.ListAddressesResponse({
                addresses:listAddresses,
            })
            callback(null, res)
        } catch (err) {
            logger.print(`Key Service: API ListAddresses: Error: ${err.toString}`)
            callback(err, null)
            
        }
    }

    KeyFromKeyOrAddress(call: ServerUnaryCall<key_pb.key.KeyFromKeyOrAddressRequest, key_pb.key.ListAddressesResponse>, callback: sendUnaryData<key_pb.key.KeyFromKeyOrAddressResponse>) {
        try {
            const chainId = call.request.chain_id
            const keyOrAddress = call.request.key_or_address
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }

            const keyName = keys.KeyFromKeyOrAddress(chainId, keyOrAddress)

            const res = new key_pb.key.KeyFromKeyOrAddressResponse({
                key_name: keyName
            })
            
            callback(null, res)
        } catch (err) {
            logger.print(`Key Service: API KeyFromKeyOrAddress: Error: ${err.toString}`)
            callback(err, null)
        }
    }
}