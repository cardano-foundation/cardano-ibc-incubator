import type { OfflineDirectSigner } from '@cosmjs/proto-signing';
import { AuthInfo, SignDoc } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import type { Any } from 'cosmjs-types/google/protobuf/any';
import { INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL } from './injectiveAccountParser';

const COSMOS_SECP256K1_PUBKEY_TYPE_URL = '/cosmos.crypto.secp256k1.PubKey';

const getSingleSignerPubkey = (authInfoBytes: Uint8Array): Any => {
  const authInfo = AuthInfo.decode(authInfoBytes);
  if (authInfo.signerInfos.length !== 1) {
    throw new Error('Injective direct signing requires exactly one signer');
  }

  const [signerInfo] = authInfo.signerInfos;
  const { publicKey } = signerInfo;
  if (!publicKey?.typeUrl) {
    throw new Error('Injective direct signing requires a public key');
  }

  return publicKey;
};

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const useInjectivePubkey = (signDoc: SignDoc): SignDoc => {
  const authInfo = AuthInfo.decode(signDoc.authInfoBytes);
  if (authInfo.signerInfos.length !== 1) {
    throw new Error('Injective direct signing requires exactly one signer');
  }

  const [signerInfo] = authInfo.signerInfos;
  const { publicKey } = signerInfo;
  if (!publicKey) {
    throw new Error('Injective direct signing requires a public key');
  }
  if (
    publicKey.typeUrl !== COSMOS_SECP256K1_PUBKEY_TYPE_URL &&
    publicKey.typeUrl !== INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL
  ) {
    throw new Error(
      `Unsupported Injective signer public key type: ${publicKey.typeUrl}`,
    );
  }

  return SignDoc.fromPartial({
    ...signDoc,
    authInfoBytes: AuthInfo.encode({
      ...authInfo,
      signerInfos: [
        {
          ...signerInfo,
          publicKey: {
            ...publicKey,
            typeUrl: INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL,
          },
        },
      ],
    }).finish(),
  });
};

export const withInjectiveDirectSigning = (
  signer: OfflineDirectSigner,
): OfflineDirectSigner => ({
  getAccounts: () => signer.getAccounts(),
  signDirect: async (signerAddress, signDoc) => {
    const injectiveSignDoc = useInjectivePubkey(signDoc);
    const expectedPublicKey = getSingleSignerPubkey(
      injectiveSignDoc.authInfoBytes,
    );
    const response = await signer.signDirect(signerAddress, injectiveSignDoc);
    const signedPublicKey = getSingleSignerPubkey(
      response.signed.authInfoBytes,
    );

    if (
      signedPublicKey.typeUrl !== INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL ||
      !equalBytes(signedPublicKey.value, expectedPublicKey.value)
    ) {
      throw new Error('Wallet did not preserve the Injective public key');
    }

    return response;
  },
});
