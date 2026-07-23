import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfflineDirectSigner } from '@cosmjs/proto-signing';
import type {
  SigningStargateClient,
  SigningStargateClientOptions,
} from '@cosmjs/stargate';
import type { Comet38Client } from '@cosmjs/tendermint-rpc';
import { injectiveAccountParser } from './injectiveAccountParser';
import {
  createInjectiveSigningClient,
  type InjectiveSigningClientFactories,
} from './injectiveSigningClient';

const RPC_ENDPOINT = 'https://injective.test/rpc';

const directSigner: OfflineDirectSigner = {
  getAccounts: async () => [],
  signDirect: async () => {
    throw new Error('not used');
  },
};

describe('Injective signing client', () => {
  it('uses the Comet 0.38 decoder explicitly', async () => {
    let connectedEndpoint;
    let receivedSigner;
    let receivedOptions: SigningStargateClientOptions | undefined;
    const cometClient = {
      disconnect: () => undefined,
    } as unknown as Comet38Client;
    const signingClient = {} as SigningStargateClient;
    const factories: InjectiveSigningClientFactories = {
      connectComet38: async (endpoint) => {
        connectedEndpoint = endpoint;
        return cometClient;
      },
      createWithSigner: async (client, signer, options) => {
        assert.equal(client, cometClient);
        receivedSigner = signer;
        receivedOptions = options;
        return signingClient;
      },
    };

    const result = await createInjectiveSigningClient(
      {
        rpcEndpoint: RPC_ENDPOINT,
        directSigner,
        feeDenom: 'inj',
        fixedMinGasPrice: 500000000,
      },
      factories,
    );

    assert.equal(result, signingClient);
    assert.equal(connectedEndpoint, RPC_ENDPOINT);
    assert.notEqual(receivedSigner, directSigner);
    assert.equal(receivedOptions?.accountParser, injectiveAccountParser);
    assert.equal(receivedOptions?.gasPrice?.toString(), '500000000inj');
  });

  it('disconnects the Comet client if signing client creation fails', async () => {
    let disconnectCount = 0;
    const cometClient = {
      disconnect: () => {
        disconnectCount += 1;
      },
    } as unknown as Comet38Client;
    const factories: InjectiveSigningClientFactories = {
      connectComet38: async () => cometClient,
      createWithSigner: async () => {
        throw new Error('creation failed');
      },
    };

    await assert.rejects(
      () =>
        createInjectiveSigningClient(
          {
            rpcEndpoint: RPC_ENDPOINT,
            directSigner,
            feeDenom: 'inj',
            fixedMinGasPrice: 500000000,
          },
          factories,
        ),
      /creation failed/,
    );
    assert.equal(disconnectCount, 1);
  });
});
