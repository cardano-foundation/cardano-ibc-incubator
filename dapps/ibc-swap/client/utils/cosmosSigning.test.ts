/* global BigInt */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MsgTransfer } from 'cosmjs-types/ibc/applications/transfer/v1/tx';
import { registry, aminoTypes } from '../configs/cosmosSigning';

test('wallet signing supports IBC transfers in protobuf and Amino formats', () => {
  const message = {
    typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
    value: MsgTransfer.fromPartial({
      sourcePort: 'transfer',
      sourceChannel: 'channel-7',
      token: { denom: 'inj', amount: '1000000000000000000' },
      sender: 'inj1sender',
      receiver: 'addr_test1receiver',
      timeoutTimestamp: BigInt('1700000000000000000'),
      memo: '',
    }),
  };
  assert.deepEqual(
    registry.decode({
      typeUrl: message.typeUrl,
      value: registry.encode(message),
    }),
    message.value,
  );
  assert.deepEqual(aminoTypes.fromAmino(aminoTypes.toAmino(message)), message);
});
