import { MsgChannelOpenInit } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import {
  Order as ChannelOrder,
  State as ChannelState,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';

import { validateAndFormatChannelOpenInitParams } from '../helper/channel.validate';

describe('channel ordering validation', () => {
  it('rejects an unrecognized ChannelOpenInit ordering', () => {
    const request: MsgChannelOpenInit = {
      port_id: 'transfer',
      channel: {
        state: ChannelState.STATE_UNINITIALIZED_UNSPECIFIED,
        ordering: ChannelOrder.UNRECOGNIZED,
        counterparty: { port_id: 'transfer', channel_id: '' },
        connection_hops: ['connection-0'],
        version: 'ics20-1',
      },
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };

    const validate = () => validateAndFormatChannelOpenInitParams(request);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('channel.ordering');
  });
});
