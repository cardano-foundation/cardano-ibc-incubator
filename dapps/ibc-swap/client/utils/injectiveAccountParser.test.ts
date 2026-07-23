/* global BigInt */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toBase64 } from '@cosmjs/encoding';
import { accountFromAny } from '@cosmjs/stargate';
import { BinaryWriter, WireType } from 'cosmjs-types/binary';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';
import { Any } from 'cosmjs-types/google/protobuf/any';
import {
  INJECTIVE_ETH_ACCOUNT_TYPE_URL,
  INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL,
  injectiveAccountParser,
} from './injectiveAccountParser';

const ADDRESS = 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe2hm49';

const encodeEthAccount = (baseAccount: BaseAccount): Uint8Array =>
  BinaryWriter.create()
    .tag(2, WireType.Bytes)
    .bytes(Uint8Array.from([1, 2, 3]))
    .tag(1, WireType.Bytes)
    .bytes(BaseAccount.encode(baseAccount).finish())
    .finish();

describe('Injective account parser', () => {
  it('unwraps an Injective EthAccount for CosmJS sequence queries', () => {
    const account = injectiveAccountParser({
      typeUrl: INJECTIVE_ETH_ACCOUNT_TYPE_URL,
      value: encodeEthAccount(
        BaseAccount.fromPartial({
          address: ADDRESS,
          accountNumber: BigInt(42),
          sequence: BigInt(7),
        }),
      ),
    });

    assert.deepEqual(account, {
      address: ADDRESS,
      pubkey: null,
      accountNumber: 42,
      sequence: 7,
    });
  });

  it('preserves Injective ethsecp256k1 public keys', () => {
    const rawPubkey = Uint8Array.from([2, ...Array<number>(32).fill(7)]);
    const encodedPubkey = BinaryWriter.create()
      .tag(1, WireType.Bytes)
      .bytes(rawPubkey)
      .finish();
    const account = injectiveAccountParser({
      typeUrl: INJECTIVE_ETH_ACCOUNT_TYPE_URL,
      value: encodeEthAccount(
        BaseAccount.fromPartial({
          address: ADDRESS,
          pubKey: Any.fromPartial({
            typeUrl: INJECTIVE_ETH_SECP256K1_PUBKEY_TYPE_URL,
            value: encodedPubkey,
          }),
          accountNumber: BigInt(1),
          sequence: BigInt(2),
        }),
      ),
    });

    assert.deepEqual(account.pubkey, {
      type: 'tendermint/PubKeySecp256k1',
      value: toBase64(rawPubkey),
    });
  });

  it('delegates standard Cosmos account types to the default parser', () => {
    const input = {
      typeUrl: BaseAccount.typeUrl,
      value: BaseAccount.encode(
        BaseAccount.fromPartial({
          address: ADDRESS,
          accountNumber: BigInt(3),
          sequence: BigInt(4),
        }),
      ).finish(),
    };

    assert.deepEqual(injectiveAccountParser(input), accountFromAny(input));
  });

  it('rejects malformed EthAccounts without an embedded base account', () => {
    assert.throws(
      () =>
        injectiveAccountParser({
          typeUrl: INJECTIVE_ETH_ACCOUNT_TYPE_URL,
          value: BinaryWriter.create()
            .tag(2, WireType.Bytes)
            .bytes(Uint8Array.from([1]))
            .finish(),
        }),
      /missing base_account/,
    );
  });

  it('rejects account values that cannot be represented safely', () => {
    assert.throws(
      () =>
        injectiveAccountParser({
          typeUrl: INJECTIVE_ETH_ACCOUNT_TYPE_URL,
          value: encodeEthAccount(
            BaseAccount.fromPartial({
              address: ADDRESS,
              accountNumber: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
              sequence: BigInt(0),
            }),
          ),
        }),
      /account number exceeds JavaScript limits/,
    );
  });
});
