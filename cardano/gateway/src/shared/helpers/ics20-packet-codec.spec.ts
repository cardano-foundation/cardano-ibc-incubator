import { ICS20_PACKET_CODEC } from '../../config/bridge-manifest';
import {
  decodeIcs20PacketDataForCodec,
  stringifyIcs20PacketDataForCodec,
  stringifyLegacyIcs20PacketData,
} from './ics20-packet-codec';

describe('deployment-selected ICS-20 packet codec', () => {
  it('accepts an existing packet above the strict size limit for a legacy deployment', () => {
    const json = stringifyLegacyIcs20PacketData({
      denom: 'uatom',
      amount: '12',
      sender: 'cardano-sender',
      receiver: 'cosmos-receiver',
      memo: 'm'.repeat(600),
    });

    const decoded = decodeIcs20PacketDataForCodec(
      Buffer.from(json, 'utf8'),
      ICS20_PACKET_CODEC.LEGACY,
    );

    expect(decoded.data.memo).toHaveLength(600);
    expect(decoded.profiles).toEqual(['legacy-cardano-json']);
  });

  it('keeps the strict size limit for a strict deployment', () => {
    const json = stringifyLegacyIcs20PacketData({
      denom: 'uatom',
      amount: '12',
      sender: 'cardano-sender',
      receiver: 'cosmos-receiver',
      memo: 'm'.repeat(600),
    });

    expect(() =>
      decodeIcs20PacketDataForCodec(
        Buffer.from(json, 'utf8'),
        ICS20_PACKET_CODEC.STRICT,
      ),
    ).toThrow('exceeds 512 bytes');
  });

  it('uses the former sorted Cardano JSON representation for legacy sends', () => {
    expect(
      stringifyLegacyIcs20PacketData({
        denom: 'uatom',
        amount: '12',
        sender: 'cardano-sender',
        receiver: 'cosmos-receiver',
      }),
    ).toBe('{"amount":"12","denom":"uatom","receiver":"cosmos-receiver","sender":"cardano-sender"}');
  });

  it('omits an empty memo and preserves the legacy JavaScript escaping and field order', () => {
    expect(
      stringifyLegacyIcs20PacketData({
        denom: '<uatom>',
        amount: '12',
        sender: 'cardano"sender',
        receiver: 'cosmos\\receiver\n',
        memo: '',
      }),
    ).toBe(
      '{"amount":"12","denom":"<uatom>","receiver":"cosmos\\\\receiver\\n","sender":"cardano\\"sender"}',
    );
  });

  it('applies packet limits only to sends made by a strict deployment', () => {
    const packet = {
      denom: 'uatom',
      amount: '12',
      sender: 'cardano-sender',
      receiver: 'cosmos-receiver',
      memo: 'm'.repeat(600),
    };

    expect(stringifyIcs20PacketDataForCodec(packet, ICS20_PACKET_CODEC.LEGACY)).toContain(packet.memo);
    expect(() => stringifyIcs20PacketDataForCodec(packet, ICS20_PACKET_CODEC.STRICT)).toThrow(
      'exceeds 512',
    );
  });
});
