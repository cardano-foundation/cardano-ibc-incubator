import { Any } from '@plus/proto-types/build/google/protobuf/any';
import { Header as HeaderMsg } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';

import { ACK_RESULT, ATTRIBUTE_KEY_CLIENT, ATTRIBUTE_KEY_PACKET, EVENT_TYPE_CLIENT, EVENT_TYPE_PACKET } from '../../constant';
import { initializeHeader } from '../types/header';
import { SpendClientRedeemer } from '../types/client-redeemer';
import {
  normalizeTxsResultFromClientDatum,
  normalizeTxsResultFromRecvPacketSuccessAcknowledgement,
} from './block-results';
import headerMockBuilder from '../../tx/test/mock/header';
import { clientDatumMockBuilder } from '../../tx/test/mock/client-datum';

function eventAttributeValue(result: any, key: string): string {
  return result.events[0].event_attribute.find((attr) => attr.key === key)?.value;
}

describe('normalizeTxsResultFromClientDatum', () => {
  it('derives replayed update_client consensus height from the submitted header', () => {
    const clientDatum = clientDatumMockBuilder.build();
    const headerMsg = headerMockBuilder.withHeight(123n).withCommitHeight(123n).withTrustedHeight(42n, 7n).build();
    const updateHeader = initializeHeader(headerMsg);
    const redeemer: SpendClientRedeemer = {
      UpdateClient: {
        msg: {
          HeaderCase: [updateHeader],
        },
      },
    };

    const result = normalizeTxsResultFromClientDatum(clientDatum, EVENT_TYPE_CLIENT.UPDATE_CLIENT, '0', redeemer);

    expect(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.CONSENSUS_HEIGHT)).toBe('7-123');
    expect(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.HEADER)).not.toBe('');
    expect(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.CLIENT_MESSAGE_ANY_HEX)).not.toBe('');

    const clientMessageAny = Any.decode(
      Buffer.from(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.CLIENT_MESSAGE_ANY_HEX), 'hex'),
    );
    const emittedHeader = HeaderMsg.decode(clientMessageAny.value);
    expect(emittedHeader.signed_header.header.version).toEqual({ block: 11n, app: 0n });
    expect(emittedHeader.signed_header.header.last_block_id.hash).toEqual(headerMsg.signed_header.header.last_block_id.hash);
    expect(emittedHeader.signed_header.commit.signatures[0].block_id_flag).toBe(
      Number(headerMsg.signed_header.commit.signatures[0].block_id_flag),
    );
  });

  it('uses frozen height for replayed client_misbehaviour events', () => {
    const clientDatum = clientDatumMockBuilder.withFrozenHeight(0n, 1n).build();
    const header1 = initializeHeader(
      headerMockBuilder.withHeight(123n).withCommitHeight(123n).withTrustedHeight(42n, 7n).build(),
    );
    const header2 = initializeHeader(
      headerMockBuilder.withHeight(122n).withCommitHeight(122n).withTrustedHeight(42n, 7n).build(),
    );
    const redeemer: SpendClientRedeemer = {
      UpdateClient: {
        msg: {
          MisbehaviourCase: [{ client_id: '07-tendermint-0', header1, header2 }],
        },
      },
    };

    const result = normalizeTxsResultFromClientDatum(clientDatum, EVENT_TYPE_CLIENT.UPDATE_CLIENT, '0', redeemer);

    expect(result.events[0].type).toBe(EVENT_TYPE_CLIENT.CLIENT_MISBEHAVIOR);
    expect(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.CONSENSUS_HEIGHT)).toBe('0-1');
    expect(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.HEADER)).toBe('');
    expect(eventAttributeValue(result, ATTRIBUTE_KEY_CLIENT.CLIENT_MESSAGE_ANY_HEX)).not.toBe('');
  });
});

describe('normalizeTxsResultFromRecvPacketSuccessAcknowledgement', () => {
  it('emits write_acknowledgement event data for recv paths without module redeemers', () => {
    const channelDatum = {
      state: {
        channel: {
          ordering: 'Unordered',
          connection_hops: [Buffer.from('connection-0').toString('hex')],
        },
      },
    } as any;
    const packet = {
      sequence: 2n,
      source_port: Buffer.from('transfer').toString('hex'),
      source_channel: Buffer.from('channel-0').toString('hex'),
      destination_port: Buffer.from('transfer').toString('hex'),
      destination_channel: Buffer.from('channel-0').toString('hex'),
      data: Buffer.from('{"denom":"uosmo"}').toString('hex'),
      timeout_height: { revisionNumber: 0n, revisionHeight: 0n },
      timeout_timestamp: 0n,
    };

    const result = normalizeTxsResultFromRecvPacketSuccessAcknowledgement({ RecvPacket: { packet } } as any, channelDatum);
    const event = result.events[0];
    const attr = (key: string) => event.event_attribute.find((entry) => entry.key === key)?.value;

    expect(event.type).toBe(EVENT_TYPE_PACKET.WRITE_ACKNOWLEDGEMENT);
    expect(attr(ATTRIBUTE_KEY_PACKET.PACKET_SEQUENCE)).toBe('2');
    expect(attr(ATTRIBUTE_KEY_PACKET.PACKET_ACK)).toBe(JSON.stringify({ result: ACK_RESULT }));
    expect(attr(ATTRIBUTE_KEY_PACKET.PACKET_ACK_HEX)).toBe(
      Buffer.from(JSON.stringify({ result: ACK_RESULT }), 'utf8').toString('hex'),
    );
    expect(attr(ATTRIBUTE_KEY_PACKET.PACKET_DATA)).toBe('{"denom":"uosmo"}');
  });
});
