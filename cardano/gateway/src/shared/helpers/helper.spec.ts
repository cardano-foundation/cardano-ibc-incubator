import { stringifyIcs20PacketData } from './helper';

describe('stringifyIcs20PacketData', () => {
  it('matches ibc-go sorted JSON packet bytes', () => {
    expect(
      stringifyIcs20PacketData({
        denom: 'inj',
        amount: '1000000000000000000',
        sender: 'inj1sender',
        receiver: '247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8',
      }),
    ).toBe(
      '{"amount":"1000000000000000000","denom":"inj","receiver":"247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8","sender":"inj1sender"}',
    );
  });

  it('places memo before receiver and sender when present', () => {
    expect(
      stringifyIcs20PacketData({
        denom: 'transfer/channel-0/uosmo',
        amount: '12',
        sender: 'cosmos1sender',
        receiver: 'addr_test1receiver',
        memo: '{"forward":{"channel":"channel-1"}}',
      }),
    ).toBe(
      '{"amount":"12","denom":"transfer/channel-0/uosmo","memo":"{\\"forward\\":{\\"channel\\":\\"channel-1\\"}}","receiver":"addr_test1receiver","sender":"cosmos1sender"}',
    );
  });
});
