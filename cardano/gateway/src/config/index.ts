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
  
  // Used by Gateway to build transactions (UTXO selection, fees, change address)
  // Hermes handles actual transaction signing
  deployerSk: string;
  
  database: PostgresConnectionOptions;

  cardanoChainHost: string;
  cardanoChainPort: number;
  cardanoChainNetworkMagic: number;
  // Logical identifier for the Cardano chain used by Hermes (e.g., "cardano-devnet").
  // Cardano itself does not have a Cosmos-style chain-id; we use this as the IBC identifier.
  cardanoChainId: string;
  cardanoNetwork: Network;
  cardanoEpochNonceGenesis: string;

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
    deployerSk: process.env.DEPLOYER_SK,

    cardanoChainHost: process.env.CARDANO_CHAIN_HOST,
    cardanoChainPort: Number(process.env.CARDANO_CHAIN_PORT || 3001),
    cardanoChainNetworkMagic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42),
    cardanoChainId: process.env.CARDANO_CHAIN_ID || 'cardano-devnet',
    cardanoNetwork: cardanoNetwork,
    cardanoEpochNonceGenesis: process.env.CARDANO_EPOCH_NONCE_GENESIS,

    mithrilEndpoint: process.env.MITHRIL_ENDPOINT,
    mtithrilGenesisVerificationKey: process.env.MITHRIL_GENESIS_VERIFICATION_KEY,
  };
};
