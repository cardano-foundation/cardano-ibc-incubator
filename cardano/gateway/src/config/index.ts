import { ConnectionConfig as IOgmiosClientConfig } from '@cardano-ogmios/client';
import deploymentConfig, { IDeploymentConfig } from './valiator.config';
import { connectionConfig } from './kupmios.config';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export interface IConfig {
  deployment: IDeploymentConfig;
  ogmiosClientConfig: IOgmiosClientConfig;
  ogmiosEndpoint: string;
  kupoEndpoint: string;
  database: PostgresConnectionOptions;
  cardanoBridgeUrl: string;
  cardanoChainHost: string;
  cardanoChainPort: number;
  cardanoChainNetworkMagic: number;
  cardanoEpochNonceGenesis: string;

  mithrilEndpoint: string;
  mtithrilGenesisVerificationKey: string;
}

export default (): Partial<IConfig> => ({
  deployment: deploymentConfig(),
  ogmiosClientConfig: connectionConfig,
  ogmiosEndpoint: process.env.OGMIOS_ENDPOINT,
  kupoEndpoint: process.env.KUPO_ENDPOINT,
  cardanoBridgeUrl: process.env.CARDANO_BRIDGE_URL,
  cardanoChainHost: process.env.CARDANO_CHAIN_HOST,
  cardanoChainPort: Number(process.env.CARDANO_CHAIN_PORT || 3001),
  cardanoChainNetworkMagic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42),
  cardanoEpochNonceGenesis: process.env.CARDANO_EPOCH_NONCE_GENESIS,
  mithrilEndpoint: process.env.MITHRIL_ENDPOINT,
  mtithrilGenesisVerificationKey: process.env.MITHRIL_GENESIS_VERIFICATION_KEY,
});
