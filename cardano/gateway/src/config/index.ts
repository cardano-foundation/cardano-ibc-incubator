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
  kupoEndpoint: string;
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

  mithrilEndpoint: string;
  mtithrilGenesisVerificationKey: string;
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
    kupoEndpoint: process.env.KUPO_ENDPOINT,
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

    mithrilEndpoint: process.env.MITHRIL_ENDPOINT,
    mtithrilGenesisVerificationKey: process.env.MITHRIL_GENESIS_VERIFICATION_KEY,
  };
};
