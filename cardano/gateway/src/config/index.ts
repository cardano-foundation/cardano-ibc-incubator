import { ConnectionConfig as IOgmiosClientConfig } from '@cardano-ogmios/client';
import signerConfig, { ISignerConfig } from './signer.config';
import deploymentConfig, { IDeploymentConfig } from './valiator.config';
import { connectionConfig } from './kupmios.config';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export interface IConfig {
  deployment: IDeploymentConfig;
  ogmiosClientConfig: IOgmiosClientConfig;
  signer: ISignerConfig;
  ogmiosEndpoint: string;
  kupoEndpoint: string;
  database: PostgresConnectionOptions;
  cardanoBridgeUrl: string;
}

export default (): Partial<IConfig> => ({
  deployment: deploymentConfig(),
  ogmiosClientConfig: connectionConfig,
  ogmiosEndpoint: process.env.OGMIOS_ENDPOINT,
  kupoEndpoint: process.env.KUPO_ENDPOINT,
  signer: signerConfig(),
  cardanoBridgeUrl: process.env.CARDANO_BRIDGE_URL,
});
