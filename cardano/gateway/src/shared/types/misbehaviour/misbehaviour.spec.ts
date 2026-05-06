import { Any } from '@plus/proto-types/build/google/protobuf/any';
import {
  Header,
  Misbehaviour as MisbehaviourMsg,
} from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';

import headerMockBuilder from '../../../tx/test/mock/header';
import { clientDatumMockBuilder } from '../../../tx/test/mock/client-datum';

import { checkForMisbehaviour, TENDERMINT_MISBEHAVIOUR_TYPE_URL } from './misbehaviour';

function header(height: bigint, seconds: bigint, blockHash: number): Header {
  return headerMockBuilder
    .withHeight(height)
    .withCommitHeight(height)
    .withTime({ seconds, nanos: 0 })
    .withCommitBlockId(Uint8Array.from([blockHash]), Uint8Array.from([blockHash]))
    .build();
}

function misbehaviourAny(header1: Header, header2: Header): Any {
  return {
    type_url: TENDERMINT_MISBEHAVIOUR_TYPE_URL,
    value: MisbehaviourMsg.encode({
      client_id: '07-tendermint-0',
      header1,
      header2,
    }).finish(),
  };
}

describe('checkForMisbehaviour', () => {
  const clientDatum = clientDatumMockBuilder.build();

  it('does not flag valid monotonic headers in normal order', () => {
    const any = misbehaviourAny(header(3n, 30n, 1), header(2n, 20n, 2));

    expect(checkForMisbehaviour(any, clientDatum)).toBe(false);
  });

  it('does not flag valid monotonic headers in reversed order', () => {
    const any = misbehaviourAny(header(2n, 20n, 1), header(3n, 30n, 2));

    expect(checkForMisbehaviour(any, clientDatum)).toBe(false);
  });

  it('flags a higher-height header with equal or earlier time', () => {
    const any = misbehaviourAny(header(3n, 20n, 1), header(2n, 20n, 2));

    expect(checkForMisbehaviour(any, clientDatum)).toBe(true);
  });

  it('flags same-height headers with different block hashes', () => {
    const any = misbehaviourAny(header(3n, 30n, 1), header(3n, 30n, 2));

    expect(checkForMisbehaviour(any, clientDatum)).toBe(true);
  });

  it('does not flag same-height headers with the same block hash', () => {
    const any = misbehaviourAny(header(3n, 30n, 1), header(3n, 30n, 1));

    expect(checkForMisbehaviour(any, clientDatum)).toBe(false);
  });
});
