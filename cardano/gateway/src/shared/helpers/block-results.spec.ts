import { ATTRIBUTE_KEY_CLIENT, EVENT_TYPE_CLIENT } from '../../constant';
import { initializeHeader } from '../types/header';
import { SpendClientRedeemer } from '../types/client-redeemer';
import { normalizeTxsResultFromClientDatum } from './block-results';
import headerMockBuilder from '../../tx/test/mock/header';
import { clientDatumMockBuilder } from '../../tx/test/mock/client-datum';

function eventAttributeValue(result: any, key: string): string {
  return result.events[0].event_attribute.find((attr) => attr.key === key)?.value;
}

describe('normalizeTxsResultFromClientDatum', () => {
  it('derives replayed update_client consensus height from the submitted header', () => {
    const clientDatum = clientDatumMockBuilder.build();
    const updateHeader = initializeHeader(
      headerMockBuilder.withHeight(123n).withCommitHeight(123n).withTrustedHeight(42n, 7n).build(),
    );
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
