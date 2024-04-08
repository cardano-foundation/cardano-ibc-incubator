import YAML from 'js-yaml'
import fs from 'fs'
import { GetPathConfig } from './config'

const pathConfig = '/config/config.yaml'

export function GetRelayerConfigPath() {
    return GetPathConfig() + pathConfig;
}

export function GetListChains() {
    try {
        const path = GetRelayerConfigPath()
        const config = YAML.load(fs.readFileSync( path, 'utf8'));
        const chains = config.chains
        return chains
    } catch (err) {
        console.log(err)
        throw Error(err)
    }
}

export function GetChainConfig(chainId:String) {
    try {
        const chains = GetListChains()
        for(const chainName in chains) {
            if(chains[chainName].value['chain-id'] == chainId) {
                return chains[chainName]
            }
        }

        throw Error('ChainId Not Found')
    } catch (err) {
        throw Error(err)
    }
}

export function ChainValid(chainId: String) {
    try{
        const chain = GetChainConfig(chainId)
        if(chain.value['chain-id'] == chainId && chain.type == 'cardano') {
            return true 
        }
        return false
    } catch(err) {
        throw Error(err)
    }
}