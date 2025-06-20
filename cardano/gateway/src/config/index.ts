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
  database: PostgresConnectionOptions;

  cardanoChainHost: string;
  cardanoChainPort: number;
  cardanoChainNetworkMagic: number;
  cardanoEpochNonceGenesis: string;

  mithrilEndpoint: string;
  mtithrilGenesisVerificationKey: string;
}

export default (): Partial<Config> => ({
  ogmiosEndpoint: process.env.OGMIOS_ENDPOINT,
  kupoEndpoint: process.env.KUPO_ENDPOINT,

  cardanoChainHost: process.env.CARDANO_CHAIN_HOST,
  cardanoChainPort: Number(process.env.CARDANO_CHAIN_PORT || 3001),
  cardanoChainNetworkMagic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42),
  cardanoEpochNonceGenesis: process.env.CARDANO_EPOCH_NONCE_GENESIS,

  mithrilEndpoint: process.env.MITHRIL_ENDPOINT,
  mtithrilGenesisVerificationKey: process.env.MITHRIL_GENESIS_VERIFICATION_KEY,
});
