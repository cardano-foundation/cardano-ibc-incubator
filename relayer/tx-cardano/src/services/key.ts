import { ServerUnaryCall, sendUnaryData } from "@grpc/grpc-js";
import * as key_pb from "../proto/protoc/key";
import * as chains from "../relayer-config/chains";
import * as keys from "../relayer-config/keys";
import { logger } from "../logger/logger";
import {validateMnemonic} from "bip39"
import { MIN_LENGTH_KEY } from "../util/constant";
import * as grpc from "@grpc/grpc-js"
import {RichServerError} from "nice-grpc-error-details"
import { Status } from "@grpc/grpc-js/build/src/constants";

export class Key extends key_pb.key.UnimplementedKeyServiceService {

    async AddKey(call: ServerUnaryCall<key_pb.key.AddKeyRequest, key_pb.key.AddKeyResponse>, callback: sendUnaryData<key_pb.key.AddKeyResponse>) {
        try {
            
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw new RichServerError(Status.INVALID_ARGUMENT, "Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }
            // check lenght key name
            if(keyName.length < MIN_LENGTH_KEY) {
                throw new RichServerError(Status.INVALID_ARGUMENT, "Invalid Key Name: Key Name must be greater than 3 characters")
            }
            // check name exits
            if(keys.KeyExist(chainId, keyName)) {
                throw new RichServerError(Status.INVALID_ARGUMENT,"Invalide Key Name: Name already exists")
            }
            // create key
            const [address,mnemonic] = await keys.GenerateKey(chainId, keyName)
            const res = new key_pb.key.AddKeyResponse({
                address: address,
                mnemonic: mnemonic
            })

            logger.print(`[Key Service] [API AddKey] [Status: Success] [Request: {chain_id: ${chainId}, key_name: ${keyName}}] [Response: {address: ${address}, mnemonic: ${mnemonic}}]`)
            callback(null, res)

        } catch (err) {
            logger.print(`[Key Service] [API AddKey] [Status: Error] [Request: {chain_id: ${call.request.chain_id}, key_name: ${call.request.key_name}]` + " [Error Msg: "+ err + "]")
            callback(err, null)
        }
    }

    async ShowAddress(call: ServerUnaryCall<key_pb.key.ShowAddressRequest, key_pb.key.ShowAddressResponse>, callback: sendUnaryData<key_pb.key.ShowAddressResponse>) {
        try {
            
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw new RichServerError(Status.INVALID_ARGUMENT, "Invalid Chain Id: Chain Id not found or Chain Type is not Cardano")
            }
            // check name exist
            if(!keys.KeyExist(chainId, keyName)) {
                throw new RichServerError(Status.INVALID_ARGUMENT, "Key Name not exist")
            }

            const key = keys.GetKey(chainId, keyName)

            const res = new key_pb.key.ShowAddressResponse({
                address: key['ADDRESS']
            })

            logger.print(`[Key Service] [API ShowAddress] [Status: Success] [Request: {chain_id: ${chainId}, key_name: ${keyName}}] [Response: {address: ${res.address}}]`)
            callback(null, res)
            
        } catch (err) {
            logger.print(`[Key Service] [API ShowAddress] [Status: Error] [Request: {chain_id: ${call.request.chain_id}, key_name: ${call.request.key_name}}]` + " [Error Msg: "+ err + "]")
            callback(err, null);
        }
    }

    async DeleteKey(call: ServerUnaryCall<key_pb.key.DeleteKeyRequest, key_pb.key.DeleteKeyResponse>, callback: sendUnaryData<key_pb.key.DeleteKeyResponse> ){
        try {
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw new RichServerError(Status.INVALID_ARGUMENT,"Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }
            // check name exist
            if(!keys.KeyExist(chainId, keyName)) {
                throw new RichServerError(Status.INVALID_ARGUMENT,"Key Name not exist")
            }
            // delete key
            await keys.DeleteKey(chainId, keyName)

            const res = new key_pb.key.DeleteKeyResponse

            logger.print(`[Key Service] [API DeleteKey] [Status: Success] [Request: {chain_id: ${chainId}, key_name: ${keyName}}] [Response:]`)
            callback(null, res)

        } catch (err) {
            logger.print(`[Key Service] [API DeleteKey] [Status: Error] [Request: {chain_id: ${call.request.chain_id}, key_name: ${call.request.key_name}}]` + " [Error Msg: "+ err + "]")
            callback(err, null);
        }
    }

    KeyExist(call: ServerUnaryCall<key_pb.key.KeyExistRequest, key_pb.key.KeyExistResponse>, callback: sendUnaryData<key_pb.key.KeyExistResponse>){
        try {
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw new RichServerError(Status.INVALID_ARGUMENT,"Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }

            const exist = keys.KeyExist(chainId, keyName)

            const res = new key_pb.key.KeyExistResponse({
                exist: exist
            })
            logger.print(`[Key Service] [API KeyExits] [Status: Success] [Request: {chain_id: ${chainId}, key_name: ${keyName}}] [Response: {exits: ${exist}}]`)
            
            callback(null, res)
        } catch (err) {
            logger.print(`[Key Service] [API KeyExits] [Status: Error] [Request: {chain_id: ${call.request.chain_id}, key_name: ${call.request.key_name}}]` + " [Error Msg: "+ err + "]")
            callback(err, null);
        }
    }

    async ListAddresses(call: ServerUnaryCall<key_pb.key.ListAddressesRequest, key_pb.key.ListAddressesResponse>, callback: sendUnaryData<key_pb.key.ListAddressesResponse>) {
        try {
            const chainId = call.request.chain_id
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw new RichServerError(Status.INVALID_ARGUMENT, "Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
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
            logger.print(`[Key Service] [API ListAddresses] [Status: Success] [Request: {chain_id: ${chainId}}] [Response: {list_addresses: ${listAddresses}}]`)
            callback(null, res)
        } catch (err) {
            logger.print(`[Key Service] [API ListAddresses] [Status: Error] [Request: {chain_id: ${call.request.chain_id}}]` + " [Error Msg: "+ err + "]")
            callback(err, null)
        }
    }

    KeyFromKeyOrAddress(call: ServerUnaryCall<key_pb.key.KeyFromKeyOrAddressRequest, key_pb.key.ListAddressesResponse>, callback: sendUnaryData<key_pb.key.KeyFromKeyOrAddressResponse>) {
        try {
            const chainId = call.request.chain_id
            const keyOrAddress = call.request.key_or_address
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw new RichServerError(Status.INVALID_ARGUMENT, "Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }

            const keyName = keys.KeyFromKeyOrAddress(chainId, keyOrAddress)

            const res = new key_pb.key.KeyFromKeyOrAddressResponse({
                key_name: keyName
            })
            
            logger.print(`[Key Service] [API KeyFromKeyOrAddress] [Status: Success] [Request: { chain_id: ${chainId}, key_or_address: ${keyOrAddress}}] [Response: {key_name: ${keyName}}]`)
            callback(null, res)
        } catch (err) {
            logger.print(`[Key Service] [API KeyFromKeyOrAddress] [Status: Error] [Request: { chain_id: ${call.request.chain_id}, key_name: ${call.request.key_or_address}}]` + " [Error Msg: "+ err + "]")
            callback(err,null)
        }
    }

    async RestoreKey(call: ServerUnaryCall<key_pb.key.RestoreKeyRequest, key_pb.key.RestoreKeyResponse>, callback: sendUnaryData<key_pb.key.RestoreKeyResponse>) {
        try {
            const chainId = call.request.chain_id
            const keyName = call.request.key_name
            const mnemonic = call.request.mnemonic
            // check chain valid
            if(!chains.ChainValid(chainId)) {
                throw Error("Invalid Chain Name: Chain Name not found or Chain Type is not Cardano")
            }
            // check lenght key name
            if(keyName.length < MIN_LENGTH_KEY) {
                throw Error("Invalid Key Name: Key Name must be greater than 3 characters")
            }
            // check name exits
            if(keys.KeyExist(chainId, keyName)) {
                throw Error("Name already exists")
            }
            // validate mnemonic
            if(!validateMnemonic(mnemonic)) {
                throw Error("Invalid Mnemonic")
            }

            const address = await keys.RestoreKey(chainId, mnemonic, keyName)

            const res = new key_pb.key.RestoreKeyResponse({
                address: address
            })

            logger.print(`[Key Service] [API RestoreKey] [Status: Success] [Request: {chain_id: ${chainId}, key_name: ${keyName}}, mnemonic: ${mnemonic}] [Response: {address: ${address}}]`)
            callback(null, res)       
        } catch (err) {
            logger.print(`[Key Service] [API RestoreKey] [Status: Error] [Request: {chain_id: ${call.request.chain_id}, key_name: ${call.request.key_name}, mnemonic: ${call.request.mnemonic}}]` + " [Error Msg: "+ err + "]")
            callback(err, null)
        }
    }
}