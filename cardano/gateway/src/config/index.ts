import { Network } from '@lucid-evolution/lucid';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

type DeploymentConfig = {
  validators: {
    spendHandler: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    spendClient: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    mintHandlerValidator: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    mintClient: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    mintConnection: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    spendConnection: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    mintChannel: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
    spendChannel: {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
    };
  };
  nonceUtxo: {
    txHash: string;
    outputIndex: number;
  };
  handlerAuthToken: {
    policyId: string;
    name: string;
  };
};

interface Config {
  deployment: DeploymentConfig;
  ogmiosEndpoint: string;
  ogmiosApiKey?: string;
  kupoEndpoint: string;
  kupoApiKey?: string;
  yaciStoreEndpoint: string;
  cardanoRestEndpoint?: string;
  entrypointRestEndpoint: string;
  localOsmosisRestEndpoint: string;
  swapRouterAddress: string;
  database: PostgresConnectionOptions;

  cardanoChainHost: string;
  cardanoChainPort: number;
  cardanoChainNetworkMagic: number;
  // Logical identifier for the Cardano chain used by Hermes (e.g., "cardano-devnet").
  // Cardano itself does not have a Cosmos-style chain-id; we use this as the IBC identifier.
  cardanoChainId: string;
  cardanoLightClientMode: 'mithril' | 'stake-weighted-stability';
  cardanoNetwork: Network;
  cardanoEpochLength: number;
  cardanoEpochNonceGenesis: string;

  mithrilEndpoint: string;
  mtithrilGenesisVerificationKey: string;
}

function runtimeEndpointOverride(
  runtimeOverrideKey: string,
  defaultKey: string,
): string | undefined {
  const runtimeOverride = process.env[runtimeOverrideKey]?.trim();
  if (runtimeOverride) {
    return runtimeOverride;
  }
  return process.env[defaultKey];
}

function runtimeOptionalOverride(
  runtimeOverrideKey: string,
  defaultKey: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(process.env, runtimeOverrideKey)) {
    const runtimeOverride = process.env[runtimeOverrideKey]?.trim();
    return runtimeOverride ? runtimeOverride : undefined;
  }
  const defaultValue = process.env[defaultKey]?.trim();
  return defaultValue ? defaultValue : undefined;
}

export default (): Partial<Config> => {
  let cardanoNetwork: Network = 'Custom';
  if (process.env.CARDANO_NETWORK_MAGIC === '1') {
    cardanoNetwork = 'Preprod';
  } else if (process.env.CARDANO_NETWORK_MAGIC === '2') {
    cardanoNetwork = 'Preview';
  } else if (process.env.CARDANO_NETWORK_MAGIC === '764824073') {
    cardanoNetwork = 'Mainnet';
  }

  return {
    ogmiosEndpoint: process.env.OGMIOS_ENDPOINT,
    ogmiosApiKey: process.env.OGMIOS_API_KEY,
    kupoEndpoint: runtimeEndpointOverride('GATEWAY_RUNTIME_KUPO_ENDPOINT', 'KUPO_ENDPOINT'),
    kupoApiKey: runtimeOptionalOverride('GATEWAY_RUNTIME_KUPO_API_KEY', 'KUPO_API_KEY'),
    yaciStoreEndpoint: process.env.YACI_STORE_ENDPOINT,
    cardanoRestEndpoint: process.env.CARDANO_REST_ENDPOINT,
    entrypointRestEndpoint: process.env.ENTRYPOINT_REST_ENDPOINT,
    localOsmosisRestEndpoint: process.env.LOCAL_OSMOSIS_REST_ENDPOINT,
    swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || '',

    cardanoChainHost: process.env.CARDANO_CHAIN_HOST,
    cardanoChainPort: Number(process.env.CARDANO_CHAIN_PORT || 3001),
    cardanoChainNetworkMagic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42),
    cardanoChainId: process.env.CARDANO_CHAIN_ID || 'cardano-devnet',
    cardanoLightClientMode:
      process.env.CARDANO_LIGHT_CLIENT_MODE === 'mithril'
        ? 'mithril'
        : 'stake-weighted-stability',
    cardanoNetwork: cardanoNetwork,
    cardanoEpochLength: Number(process.env.CARDANO_EPOCH_LENGTH || 432000),
    cardanoEpochNonceGenesis: process.env.CARDANO_EPOCH_NONCE_GENESIS || '',

    mithrilEndpoint: process.env.MITHRIL_ENDPOINT,
    mtithrilGenesisVerificationKey: process.env.MITHRIL_GENESIS_VERIFICATION_KEY,
  };
};
