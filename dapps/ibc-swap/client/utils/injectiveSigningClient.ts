import type { OfflineDirectSigner } from '@cosmjs/proto-signing';
import {
  GasPrice,
  SigningStargateClient,
  type SigningStargateClientOptions,
} from '@cosmjs/stargate';
import { Comet38Client, type HttpEndpoint } from '@cosmjs/tendermint-rpc';
import { injectiveAccountParser } from './injectiveAccountParser';
import { withInjectiveDirectSigning } from './injectiveDirectSigner';

type RpcEndpoint = string | HttpEndpoint;

const connectComet38 = (endpoint: RpcEndpoint): Promise<Comet38Client> =>
  Comet38Client.connect(endpoint);

const createWithSigner = (
  cometClient: Comet38Client,
  signer: OfflineDirectSigner,
  options: SigningStargateClientOptions,
): Promise<SigningStargateClient> =>
  SigningStargateClient.createWithSigner(cometClient, signer, options);

export type InjectiveSigningClientFactories = {
  connectComet38: typeof connectComet38;
  createWithSigner: typeof createWithSigner;
};

const defaultFactories: InjectiveSigningClientFactories = {
  connectComet38,
  createWithSigner,
};

export const createInjectiveSigningClient = async (
  {
    rpcEndpoint,
    directSigner,
    feeDenom,
    fixedMinGasPrice,
  }: {
    rpcEndpoint: RpcEndpoint;
    directSigner: OfflineDirectSigner;
    feeDenom: string;
    fixedMinGasPrice: number;
  },
  factories: InjectiveSigningClientFactories = defaultFactories,
): Promise<SigningStargateClient> => {
  const options: SigningStargateClientOptions = {
    accountParser: injectiveAccountParser,
    gasPrice: GasPrice.fromString(`${fixedMinGasPrice}${feeDenom}`),
  };

  // Injective reports CometBFT 1.x, which CosmJS 0.32 otherwise
  // misidentifies as Tendermint 0.34 and decodes plain event text as base64.
  const cometClient = await factories.connectComet38(rpcEndpoint);
  try {
    return await factories.createWithSigner(
      cometClient,
      withInjectiveDirectSigning(directSigner),
      options,
    );
  } catch (error) {
    cometClient.disconnect();
    throw error;
  }
};
