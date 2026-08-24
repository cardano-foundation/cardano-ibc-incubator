import { Network } from '@lucid-evolution/lucid';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

type DeploymentConfig = {
  validators: {
    spendClient: {
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
};

const defaultKoiosEndpoint = (networkMagic?: string): string | undefined => {
  switch (networkMagic) {
    case '1':
      return 'https://preprod.koios.rest/api/v1';
    case '2':
      return 'https://preview.koios.rest/api/v1';
    default:
      return undefined;
  }
};

const defaultEpochLength = (networkMagic?: string): number => {
  switch (networkMagic) {
    case '2':
      return 86_400;
    case '42':
      return 5_000;
    default:
      return 432_000;
  }
};

const positiveSafeIntegerEnv = (name: string, fallback: number): number => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
};

const maxGoDurationSeconds = 9_223_372_036;

const positiveGoDurationSecondsEnv = (name: string, fallback: number): number => {
  const value = positiveSafeIntegerEnv(name, fallback);
  if (value > maxGoDurationSeconds) {
    throw new Error(`${name} must not exceed ${maxGoDurationSeconds.toString()} seconds`);
  }
  return value;
};

interface Config {
  deployment: DeploymentConfig;
  ogmiosEndpoint: string;
  ogmiosApiKey?: string;
  kupoEndpoint: string;
  kupoApiKey?: string;
  yaciStoreEndpoint: string;
  cardanoRestEndpoint?: string;
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
  cardanoClientTrustingPeriodSeconds: number;
  cardanoClientMaxClockDriftSeconds: number;
  cardanoStabilityCheckpointMaxBridgeBlocks: number;
  cardanoStabilityCheckpointMaxHeaderBytes: number;
  cardanoEpochParamsEndpoint?: string;
  cardanoPoolRegistrationHistoryEndpoint?: string;
  cardanoKoiosApiKey?: string;

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
    ogmiosApiKey: process.env.OGMIOS_API_KEY,
    kupoEndpoint: process.env.KUPO_ENDPOINT,
    kupoApiKey: process.env.KUPO_API_KEY,
    yaciStoreEndpoint: process.env.YACI_STORE_ENDPOINT,
    cardanoRestEndpoint: process.env.CARDANO_REST_ENDPOINT,
    localOsmosisRestEndpoint: process.env.LOCAL_OSMOSIS_REST_ENDPOINT,
    swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS || '',

    cardanoChainHost: process.env.CARDANO_CHAIN_HOST,
    cardanoChainPort: Number(process.env.CARDANO_CHAIN_PORT || 3001),
    cardanoChainNetworkMagic: Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || 42),
    cardanoChainId: process.env.CARDANO_CHAIN_ID || 'cardano-devnet',
    cardanoLightClientMode:
      process.env.CARDANO_LIGHT_CLIENT_MODE === 'mithril' ? 'mithril' : 'stake-weighted-stability',
    cardanoNetwork: cardanoNetwork,
    cardanoEpochLength: Number(
      process.env.CARDANO_EPOCH_LENGTH || defaultEpochLength(process.env.CARDANO_NETWORK_MAGIC),
    ),
    cardanoClientTrustingPeriodSeconds: Number(process.env.CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS || 86_400),
    cardanoClientMaxClockDriftSeconds: positiveGoDurationSecondsEnv(
      'CARDANO_CLIENT_MAX_CLOCK_DRIFT_SECONDS',
      10,
    ),
    cardanoStabilityCheckpointMaxBridgeBlocks: Number(
      process.env.CARDANO_STABILITY_CHECKPOINT_MAX_BRIDGE_BLOCKS || 32,
    ),
    cardanoStabilityCheckpointMaxHeaderBytes: Number(
      process.env.CARDANO_STABILITY_CHECKPOINT_MAX_HEADER_BYTES || 768 * 1024,
    ),
    cardanoEpochParamsEndpoint:
      process.env.CARDANO_EPOCH_PARAMS_ENDPOINT || defaultKoiosEndpoint(process.env.CARDANO_NETWORK_MAGIC),
    cardanoPoolRegistrationHistoryEndpoint:
      process.env.CARDANO_POOL_REGISTRATION_HISTORY_ENDPOINT || defaultKoiosEndpoint(process.env.CARDANO_NETWORK_MAGIC),
    cardanoKoiosApiKey:
      process.env.CARDANO_KOIOS_API_KEY || process.env.CARIBIC_KOIOS_API_KEY || process.env.KOIOS_API_KEY,

    mithrilEndpoint: process.env.MITHRIL_ENDPOINT,
    mtithrilGenesisVerificationKey: process.env.MITHRIL_GENESIS_VERIFICATION_KEY,
  };
};
