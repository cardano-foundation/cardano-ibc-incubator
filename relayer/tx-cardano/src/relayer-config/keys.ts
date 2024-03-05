import { homedir } from 'os'
import { Lucid } from 'lucid-cardano'
import fs from "fs"
import * as chains from "./chains";
import { key } from '../proto/protoc/key'

const userHomeDir = homedir()
const pathConfig = '/.relayer/config/config.yaml'
const pathKeys = '/.relayer/keys/'

export function GetRelayerConfigPath() {
    return userHomeDir + pathConfig;
}

export function GetKeysPathWithKeyName(chainId:string, keyName:string) {
    return userHomeDir + pathKeys + chainId + '/keyring-test/' + keyName + '.info'
}

export function GetKeysPathWithAddress(chainId:string, address:string) {
    return userHomeDir + pathKeys + chainId + '/keyring-test/' + address + '.address'
}

export function KeyExist(chainId:string, keyName:string) {
    try {
        const path = GetKeysPathWithKeyName(chainId, keyName)
        if(fs.existsSync(path)) {
            return true;
        } else {
            return false;
        }
    } catch (err) {
        console.log(err);
        throw Error(err);
    }
}

export async function GenerateKey(chainId:string, keyName:string) {
    try {
        const lucid = await Lucid.new(undefined,"Preview");

        const privateKey = lucid.utils.generatePrivateKey();
        const address = await lucid.selectWalletFromPrivateKey(privateKey).wallet.address();

        const data = `PRIVATEKEY=${privateKey}\nADDRESS=${address}\nNAME=${keyName}`;

        const keyPathName = GetKeysPathWithKeyName(chainId, keyName);
        const keyPathAddress = GetKeysPathWithAddress(chainId, address);
        
        fs.writeFileSync(keyPathName,data);
        fs.writeFileSync(keyPathAddress, data);

        return address
    } catch (err) {
        console.log(err);
        throw Error(err);
    }
}

export function GetKey(chainId:string, keyName:string) {
    try {
        const path = GetKeysPathWithKeyName(chainId, keyName);

        const data = fs.readFileSync(path, 'utf-8')
        
        const lines = data.split('\n');
        const keyValuePairs = lines.map(line => line.split('='));

        const keyObject = keyValuePairs.reduce((acc, [key, value]) => ({ ...acc, [key]: (value || "").trim() }), {});

        return keyObject
    
    } catch (err) {
        console.log(err);
        throw Error(err);
    }
}

export async function DeleteKey(chainId:string, keyName:string) {
    try {
        const pathName = GetKeysPathWithKeyName(chainId, keyName)
        const key = await GetKey(chainId, keyName)
        const pathAddress = GetKeysPathWithAddress(chainId,key['ADDRESS'])

        // delete file <key_name>.info
        fs.unlinkSync(pathName)
        // delete file <address>.address
        // TODO: rever file <key_name>.info if err
        fs.unlinkSync(pathAddress)
    } catch (err) {
        console.log(err);
        throw Error(err)
    }
}

export async function GetListKey(chainId:string) {
    try {
        const pathFolder = homedir + pathKeys + chainId

        if(!fs.existsSync(pathFolder)) {
            fs.mkdirSync(pathFolder)
        }

        const path = pathFolder+ '/keyring-test/'
        // fs.accessSync
        if(!fs.existsSync(path)) {
            fs.mkdirSync(path)
        }

        const files = fs.readdirSync(path, {});

        let listKeyName: string[] = [];
        files.forEach(file => {
            if(file.endsWith('.info')) {
                const name = file.split('.')[0];
                listKeyName.push(name)
            }
        });
        
        const keys = await Promise.all(listKeyName.map(keyName => GetKey(chainId, keyName))).catch(() => []) || []
        return keys
    } catch (err) {
        console.log(err);
        throw Error(err);
    }
}

export function KeyFromKeyOrAddress(chainId:string, keyNamOrAddress: string) {
    try{
        if(KeyExist(chainId, keyNamOrAddress)) {
            return keyNamOrAddress
        }
        const path = GetKeysPathWithAddress(chainId, keyNamOrAddress)

        if(fs.existsSync(path)) {
            const data = fs.readFileSync(path, 'utf-8')
        
            const lines = data.split('\n');
            const keyValuePairs = lines.map(line => line.split('='));

            const keyObject = keyValuePairs.reduce((acc, [key, value]) => ({ ...acc, [key]: value.trim() }), {});

            return keyObject['NAME']
        }

        return ""
    } catch(err) {
        console.log(err);
        throw Error
    }
}

export function GetPrivateKeyUse(chainId: string) {
    try{
        // get chain
        const chain = chains.GetChainConfig(chainId)
        // get key use
        const key = GetKey(chainId, chain.value.key)
        return key['PRIVATEKEY']
    } catch(err) {
        console.log(err)
        throw Error
    }
}