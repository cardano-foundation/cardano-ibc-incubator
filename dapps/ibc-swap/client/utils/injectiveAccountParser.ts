import { accountFromAny, type AccountParser } from '@cosmjs/stargate';
import { BinaryReader, WireType } from 'cosmjs-types/binary';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';

export const INJECTIVE_ETH_ACCOUNT_TYPE_URL =
  '/injective.types.v1beta1.EthAccount';
export const INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL =
  '/injective.crypto.v1beta1.ethsecp256k1.PubKey';
const COSMOS_SECP256K1_PUBKEY_TYPE_URL = '/cosmos.crypto.secp256k1.PubKey';

const assertSafeAccountValue = (value: bigint, fieldName: string): void => {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`Injective account ${fieldName} exceeds JavaScript limits`);
  }
};

const decodeEthBaseAccount = (value: Uint8Array): BaseAccount => {
  const reader = new BinaryReader(value);
  let baseAccount: BaseAccount | undefined;

  while (reader.pos < reader.len) {
    const [fieldNumber, wireType] = reader.tag();
    if (fieldNumber === 1) {
      if (wireType !== WireType.Bytes) {
        throw new Error(
          'Injective EthAccount base_account has invalid encoding',
        );
      }
      baseAccount = BaseAccount.decode(reader.bytes());
    } else {
      reader.skipType(wireType);
    }
  }

  if (!baseAccount) {
    throw new Error('Injective EthAccount is missing base_account');
  }

  return baseAccount;
};

export const injectiveAccountParser: AccountParser = (input) => {
  if (input.typeUrl !== INJECTIVE_ETH_ACCOUNT_TYPE_URL) {
    return accountFromAny(input);
  }

  const baseAccount = decodeEthBaseAccount(input.value);
  assertSafeAccountValue(baseAccount.accountNumber, 'account number');
  assertSafeAccountValue(baseAccount.sequence, 'sequence');
  const normalizedPubKey =
    baseAccount.pubKey?.typeUrl === INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL
      ? {
          ...baseAccount.pubKey,
          typeUrl: COSMOS_SECP256K1_PUBKEY_TYPE_URL,
        }
      : baseAccount.pubKey;

  return accountFromAny({
    typeUrl: BaseAccount.typeUrl,
    value: BaseAccount.encode({
      ...baseAccount,
      pubKey: normalizedPubKey,
    }).finish(),
  });
};
