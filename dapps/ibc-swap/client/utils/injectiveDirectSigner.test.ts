import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeSecp256k1Pubkey } from '@cosmjs/amino';
import { toBase64 } from '@cosmjs/encoding';
import {
  encodePubkey,
  makeAuthInfoBytes,
  makeSignDoc,
  type OfflineDirectSigner,
} from '@cosmjs/proto-signing';
import { SigningStargateClient } from '@cosmjs/stargate';
import { AuthInfo, type SignDoc } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL } from './injectiveAccountParser';
import {
  useInjectivePubkey,
  withInjectiveDirectSigning,
} from './injectiveDirectSigner';

const ADDRESS = 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe2hm49';
const RAW_PUBKEY = Uint8Array.from([2, ...Array<number>(32).fill(7)]);
const COSMOS_PUBKEY = encodePubkey(encodeSecp256k1Pubkey(RAW_PUBKEY));
const EMPTY_FEE = { amount: [], gas: '200000' };

const createStandardSignDoc = () =>
  makeSignDoc(
    new Uint8Array(),
    makeAuthInfoBytes(
      [{ pubkey: COSMOS_PUBKEY, sequence: 3 }],
      EMPTY_FEE.amount,
      Number(EMPTY_FEE.gas),
      undefined,
      undefined,
    ),
    'injective-888',
    9,
  );

const getPubkeyType = (authInfoBytes: Uint8Array): string | undefined =>
  AuthInfo.decode(authInfoBytes).signerInfos[0]?.publicKey?.typeUrl;

describe('Injective direct signer', () => {
  it('rewrites the signer info to Injective ethsecp256k1', () => {
    const original = createStandardSignDoc();
    const updated = useInjectivePubkey(original);

    assert.equal(
      getPubkeyType(updated.authInfoBytes),
      INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL,
    );
    assert.deepEqual(
      AuthInfo.decode(updated.authInfoBytes).signerInfos[0].publicKey?.value,
      COSMOS_PUBKEY.value,
    );
    assert.equal(
      getPubkeyType(original.authInfoBytes),
      '/cosmos.crypto.secp256k1.PubKey',
    );
  });

  it('integrates with the standard CosmJS direct-sign flow', async () => {
    let walletSignDoc: SignDoc | undefined;
    const walletSigner: OfflineDirectSigner = {
      getAccounts: async () => [
        {
          address: ADDRESS,
          algo: 'secp256k1',
          pubkey: RAW_PUBKEY,
        },
      ],
      signDirect: async (_signerAddress, signDoc) => {
        walletSignDoc = signDoc;
        return {
          signed: signDoc,
          signature: {
            pub_key: encodeSecp256k1Pubkey(RAW_PUBKEY),
            signature: toBase64(new Uint8Array(64)).replace(/=+$/, ''),
          },
        };
      },
    };
    const client = await SigningStargateClient.offline(
      withInjectiveDirectSigning(walletSigner),
    );

    const signedTx = await client.sign(ADDRESS, [], EMPTY_FEE, '', {
      accountNumber: 9,
      sequence: 3,
      chainId: 'injective-888',
    });

    assert.ok(walletSignDoc);
    assert.equal(
      getPubkeyType(walletSignDoc.authInfoBytes),
      INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL,
    );
    assert.equal(
      getPubkeyType(signedTx.authInfoBytes),
      INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL,
    );
    assert.equal(signedTx.signatures[0].length, 64);
  });

  it('preserves a canonical wallet signature', async () => {
    const original = createStandardSignDoc();
    const canonicalSignature = toBase64(new Uint8Array(64));
    const walletSigner: OfflineDirectSigner = {
      getAccounts: async () => [],
      signDirect: async (_signerAddress, signDoc) => ({
        signed: signDoc,
        signature: {
          pub_key: encodeSecp256k1Pubkey(RAW_PUBKEY),
          signature: canonicalSignature,
        },
      }),
    };

    const response = await withInjectiveDirectSigning(walletSigner).signDirect(
      ADDRESS,
      original,
    );

    assert.equal(response.signature.signature, canonicalSignature);
  });

  it('rejects malformed or incorrectly sized wallet signatures', async () => {
    const original = createStandardSignDoc();
    const walletSigner = (signature: string): OfflineDirectSigner => ({
      getAccounts: async () => [],
      signDirect: async (_signerAddress, signDoc) => ({
        signed: signDoc,
        signature: {
          pub_key: encodeSecp256k1Pubkey(RAW_PUBKEY),
          signature,
        },
      }),
    });

    await assert.rejects(
      () =>
        withInjectiveDirectSigning(walletSigner('A')).signDirect(
          ADDRESS,
          original,
        ),
      /invalid base64 signature/,
    );
    await assert.rejects(
      () =>
        withInjectiveDirectSigning(
          walletSigner(`${toBase64(new Uint8Array(64))}=`),
        ).signDirect(ADDRESS, original),
      /invalid base64 signature/,
    );
    await assert.rejects(
      () =>
        withInjectiveDirectSigning(
          walletSigner(`_${'A'.repeat(85)}`),
        ).signDirect(ADDRESS, original),
      /invalid base64 signature/,
    );
    await assert.rejects(
      () =>
        withInjectiveDirectSigning(walletSigner('ab'.repeat(64))).signDirect(
          ADDRESS,
          original,
        ),
      /invalid signature length/,
    );
  });

  it('fails closed if a wallet replaces the Injective auth info', async () => {
    const original = createStandardSignDoc();
    const walletSigner: OfflineDirectSigner = {
      getAccounts: async () => [],
      signDirect: async () => ({
        signed: original,
        signature: {
          pub_key: encodeSecp256k1Pubkey(RAW_PUBKEY),
          signature: toBase64(new Uint8Array(64)),
        },
      }),
    };

    await assert.rejects(
      () =>
        withInjectiveDirectSigning(walletSigner).signDirect(ADDRESS, original),
      /did not preserve the Injective public key/,
    );
  });

  it('rejects a wallet response containing a different public key', async () => {
    const original = createStandardSignDoc();
    const walletSigner: OfflineDirectSigner = {
      getAccounts: async () => [],
      signDirect: async (_signerAddress, signDoc) => {
        const authInfo = AuthInfo.decode(signDoc.authInfoBytes);
        const [signerInfo] = authInfo.signerInfos;
        return {
          signed: {
            ...signDoc,
            authInfoBytes: AuthInfo.encode({
              ...authInfo,
              signerInfos: [
                {
                  ...signerInfo,
                  publicKey: {
                    ...signerInfo.publicKey!,
                    value: Uint8Array.from([10, 1, 2]),
                  },
                },
              ],
            }).finish(),
          },
          signature: {
            pub_key: encodeSecp256k1Pubkey(RAW_PUBKEY),
            signature: toBase64(new Uint8Array(64)),
          },
        };
      },
    };

    await assert.rejects(
      () =>
        withInjectiveDirectSigning(walletSigner).signDirect(ADDRESS, original),
      /did not preserve the Injective public key/,
    );
  });
});
