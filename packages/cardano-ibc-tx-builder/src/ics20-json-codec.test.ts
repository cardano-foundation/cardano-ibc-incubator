import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  decodeIcs20ClassicPacketData,
  encodeIcs20ClassicPacketData,
  ICS20_CLASSIC_JSON_LIMITS,
  Ics20ClassicJsonCodecError,
  type Ics20ClassicJsonProfile,
  type Ics20ClassicJsonCodecErrorCode,
  type Ics20ClassicPacketData,
  stringifyIcs20PacketData,
} from './ics20-json-codec';

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

type VectorProfile = 'cardano' | 'ibcGoV8' | 'ibcGoV10' | 'ibcRsV053';
type VectorFixture = {
  vectors: Array<{
    name: string;
    data: Required<Ics20ClassicPacketData>;
    wire: Record<VectorProfile, { json: string; hex: string }>;
  }>;
};

const vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../tests/ics20-json-vectors/vectors.json'), 'utf8'),
) as VectorFixture;

const basePacket = (overrides: Partial<Ics20ClassicPacketData> = {}): Ics20ClassicPacketData => ({
  denom: 'transfer/channel-0/uatom',
  amount: '12',
  sender: 'cosmos1sender',
  receiver: 'addr_test1receiver',
  ...overrides,
});

function assertCodecError(action: () => unknown, code: Ics20ClassicJsonCodecErrorCode): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Ics20ClassicJsonCodecError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('ICS-20 Classic JSON canonical profiles', () => {
  it('matches every pinned Cardano, ibc-go, and ibc-rs vector', () => {
    const expectedProfiles: Record<VectorProfile, Ics20ClassicJsonProfile> = {
      cardano: 'cardano-js-sorted',
      ibcGoV8: 'ibc-go-v8-sorted',
      ibcGoV10: 'ibc-go-v10',
      ibcRsV053: 'ibc-rs-v0.53',
    };

    for (const vector of vectors.vectors) {
      const cardanoBytes = encodeIcs20ClassicPacketData(vector.data);
      assert.equal(
        Buffer.from(cardanoBytes).toString('hex'),
        vector.wire.cardano.hex,
        `${vector.name}: Cardano hex`,
      );
      assert.equal(
        stringifyIcs20PacketData(vector.data),
        vector.wire.cardano.json,
        `${vector.name}: Cardano JSON`,
      );

      for (const profile of Object.keys(expectedProfiles) as VectorProfile[]) {
        const expected = vector.wire[profile];
        const decoded = decodeIcs20ClassicPacketData(Buffer.from(expected.hex, 'hex'));
        assert.equal(decoded.json, expected.json, `${vector.name}: ${profile}`);
        assert.deepEqual(decoded.data, vector.data, `${vector.name}: ${profile}`);
        assert.ok(
          decoded.profiles.includes(expectedProfiles[profile]),
          `${vector.name}: ${profile} was not recognized`,
        );
      }
    }
  });

  it('preserves Cardano sorted JavaScript emission and omits an empty memo', () => {
    const packet = basePacket({ memo: '' });
    const expected =
      '{"amount":"12","denom":"transfer/channel-0/uatom","receiver":"addr_test1receiver","sender":"cosmos1sender"}';

    assert.equal(stringifyIcs20PacketData(packet), expected);
    assert.equal(stringifyIcs20PacketData({ ...basePacket(), memo: undefined }), expected);
    assert.deepEqual(encodeIcs20ClassicPacketData(packet), utf8(expected));
  });

  it('puts a non-empty memo before receiver and sender', () => {
    assert.equal(
      stringifyIcs20PacketData(basePacket({ memo: '{"forward":{"channel":"channel-1"}}' })),
      '{"amount":"12","denom":"transfer/channel-0/uatom","memo":"{\\"forward\\":{\\"channel\\":\\"channel-1\\"}}","receiver":"addr_test1receiver","sender":"cosmos1sender"}',
    );
  });

  it('recognizes identical ordinary Cardano and ibc-go v8 bytes', () => {
    const json = stringifyIcs20PacketData(basePacket());
    const decoded = decodeIcs20ClassicPacketData(utf8(json));

    assert.deepEqual(decoded.data, { ...basePacket(), memo: '' });
    assert.deepEqual(decoded.profiles, ['cardano-js-sorted', 'ibc-go-v8-sorted']);
    assert.equal(decoded.json, json);
  });

  it('recognizes Cardano JavaScript escaping exactly', () => {
    const packet = basePacket({ denom: 'a<>&\u2028\u2029b' });
    const json = stringifyIcs20PacketData(packet);

    assert.ok(json.includes('a<>&\u2028\u2029b'));
    assert.deepEqual(decodeIcs20ClassicPacketData(utf8(json)).profiles, ['cardano-js-sorted']);
  });

  it('recognizes ibc-go v8 sorted order and Go escaping exactly', () => {
    const json =
      '{"amount":"12","denom":"a\\u003cb\\u003ec\\u0026d\\u2028e\\u2029f","receiver":"addr_test1receiver","sender":"cosmos1sender"}';
    const decoded = decodeIcs20ClassicPacketData(utf8(json));

    assert.equal(decoded.data.denom, 'a<b>c&d\u2028e\u2029f');
    assert.deepEqual(decoded.profiles, ['ibc-go-v8-sorted']);
  });

  it('recognizes ibc-go v10 field order and Go escaping exactly', () => {
    const json =
      '{"denom":"a\\u003cb\\u003ec\\u0026d\\u2028e\\u2029f","amount":"12","sender":"cosmos1sender","receiver":"addr_test1receiver","memo":"memo"}';
    const decoded = decodeIcs20ClassicPacketData(utf8(json));

    assert.deepEqual(decoded.data, {
      denom: 'a<b>c&d\u2028e\u2029f',
      amount: '12',
      sender: 'cosmos1sender',
      receiver: 'addr_test1receiver',
      memo: 'memo',
    });
    assert.deepEqual(decoded.profiles, ['ibc-go-v10']);
  });

  it('recognizes the ibc-rs field order and explicit empty memo', () => {
    const json =
      '{"denom":"uatom","amount":"10","sender":"cosmos1sender","receiver":"cardano-receiver","memo":""}';
    const decoded = decodeIcs20ClassicPacketData(utf8(json));

    assert.deepEqual(decoded.data, {
      denom: 'uatom',
      amount: '10',
      sender: 'cosmos1sender',
      receiver: 'cardano-receiver',
      memo: '',
    });
    assert.deepEqual(decoded.profiles, ['ibc-rs-v0.53']);
  });

  it('recognizes serde-json-wasm escaping used by ibc-rs v0.53', () => {
    const json =
      '{"denom":"a<>&\u2028\u2029b","amount":"12","sender":"sender","receiver":"receiver","memo":"\\u000B"}';
    const decoded = decodeIcs20ClassicPacketData(utf8(json));

    assert.equal(decoded.data.denom, 'a<>&\u2028\u2029b');
    assert.equal(decoded.data.memo, '\u000b');
    assert.deepEqual(decoded.profiles, ['ibc-rs-v0.53']);
  });

  it('handles canonical quote, slash, backslash, and control escaping', () => {
    const packet = basePacket({ memo: '"/\\\b\f\n\r\t\u0000' });
    const json = stringifyIcs20PacketData(packet);

    assert.deepEqual(decodeIcs20ClassicPacketData(utf8(json)).data, packet);
  });
});

describe('ICS-20 Classic JSON strict decoding', () => {
  it('rejects invalid UTF-8 before JSON parsing', () => {
    assertCodecError(
      () => decodeIcs20ClassicPacketData(new Uint8Array([0xc3, 0x28])),
      'invalid_utf8',
    );
  });

  it('rejects a UTF-8 byte-order mark before canonical JSON', () => {
    const canonical = encodeIcs20ClassicPacketData(basePacket());
    const withBom = new Uint8Array(canonical.byteLength + 3);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(canonical, 3);

    assertCodecError(() => decodeIcs20ClassicPacketData(withBom), 'malformed_json');
  });

  it('rejects malformed JSON and trailing data', () => {
    for (const json of ['{bad}', '{} trailing']) {
      assertCodecError(() => decodeIcs20ClassicPacketData(utf8(json)), 'malformed_json');
    }
  });

  it('rejects duplicate and unknown fields', () => {
    const duplicate =
      '{"amount":"12","amount":"12","denom":"uatom","receiver":"receiver","sender":"sender"}';
    assertCodecError(() => decodeIcs20ClassicPacketData(utf8(duplicate)), 'non_canonical');

    const unknown =
      '{"amount":"12","denom":"uatom","receiver":"receiver","sender":"sender","extra":"value"}';
    assertCodecError(() => decodeIcs20ClassicPacketData(utf8(unknown)), 'invalid_shape');
  });

  it('rejects non-object JSON values', () => {
    for (const json of ['null', '[]', '"packet"', '1']) {
      assertCodecError(() => decodeIcs20ClassicPacketData(utf8(json)), 'invalid_shape');
    }
  });

  it('rejects each missing required field', () => {
    for (const missing of ['denom', 'amount', 'sender', 'receiver']) {
      const packet = basePacket() as Record<string, unknown>;
      delete packet[missing];
      assertCodecError(
        () => decodeIcs20ClassicPacketData(utf8(JSON.stringify(packet))),
        'invalid_shape',
      );
    }
  });

  it('rejects empty required fields', () => {
    for (const field of ['denom', 'amount', 'sender', 'receiver'] as const) {
      const packet = basePacket({ [field]: '' });
      assertCodecError(
        () => decodeIcs20ClassicPacketData(utf8(JSON.stringify(packet))),
        'invalid_shape',
      );
    }
  });

  it('rejects wrong field types', () => {
    for (const field of ['denom', 'amount', 'sender', 'receiver', 'memo'] as const) {
      const packet: Record<string, unknown> = basePacket();
      packet[field] = 12;
      assertCodecError(
        () => decodeIcs20ClassicPacketData(utf8(JSON.stringify(packet))),
        'invalid_shape',
      );
    }
  });

  it('rejects non-canonical key order, whitespace, escapes, and sorted empty memo', () => {
    const nonCanonicalPackets = [
      '{"denom":"uatom","sender":"sender","amount":"12","receiver":"receiver"}',
      `${stringifyIcs20PacketData(basePacket())}\n`,
      '{"amount":"12","denom":"uatom","receiver":"receiver","sender":"\\u0073ender"}',
      '{"amount":"12","denom":"uatom","memo":"","receiver":"receiver","sender":"sender"}',
    ];

    for (const json of nonCanonicalPackets) {
      assertCodecError(() => decodeIcs20ClassicPacketData(utf8(json)), 'non_canonical');
    }
  });

  it('rejects escaped lone Unicode surrogates', () => {
    const json = '{"amount":"12","denom":"\\ud800","receiver":"receiver","sender":"sender"}';
    assertCodecError(() => decodeIcs20ClassicPacketData(utf8(json)), 'invalid_utf8');
  });
});

describe('ICS-20 Classic JSON byte limits', () => {
  it('exports the centralized limits', () => {
    assert.deepEqual(ICS20_CLASSIC_JSON_LIMITS, {
      packetBytes: 512,
      denomBytes: 256,
      amountBytes: 78,
      senderBytes: 256,
      receiverBytes: 256,
      memoBytes: 512,
    });
  });

  it('accepts each reachable field at its UTF-8 byte limit', () => {
    const cases: Array<[keyof Ics20ClassicPacketData, string]> = [
      ['denom', 'd'.repeat(ICS20_CLASSIC_JSON_LIMITS.denomBytes)],
      ['amount', '1'.repeat(ICS20_CLASSIC_JSON_LIMITS.amountBytes)],
      ['sender', 's'.repeat(ICS20_CLASSIC_JSON_LIMITS.senderBytes)],
      ['receiver', 'r'.repeat(ICS20_CLASSIC_JSON_LIMITS.receiverBytes)],
    ];

    for (const [field, value] of cases) {
      const json = stringifyIcs20PacketData(basePacket({ [field]: value }));
      assert.equal(decodeIcs20ClassicPacketData(utf8(json)).data[field], value);
    }
  });

  it('measures field limits in UTF-8 bytes rather than characters', () => {
    const atLimit = 'é'.repeat(ICS20_CLASSIC_JSON_LIMITS.denomBytes / 2);
    const overLimit = `${atLimit}é`;

    assert.equal(
      decodeIcs20ClassicPacketData(encodeIcs20ClassicPacketData(basePacket({ denom: atLimit })))
        .data.denom,
      atLimit,
    );
    assertCodecError(
      () => stringifyIcs20PacketData(basePacket({ denom: overLimit })),
      'field_too_large',
    );
  });

  it('rejects every field above its byte limit', () => {
    const cases: Array<[keyof Ics20ClassicPacketData, string]> = [
      ['denom', 'd'.repeat(ICS20_CLASSIC_JSON_LIMITS.denomBytes + 1)],
      ['amount', '1'.repeat(ICS20_CLASSIC_JSON_LIMITS.amountBytes + 1)],
      ['sender', 's'.repeat(ICS20_CLASSIC_JSON_LIMITS.senderBytes + 1)],
      ['receiver', 'r'.repeat(ICS20_CLASSIC_JSON_LIMITS.receiverBytes + 1)],
      ['memo', 'm'.repeat(ICS20_CLASSIC_JSON_LIMITS.memoBytes + 1)],
    ];

    for (const [field, value] of cases) {
      assertCodecError(
        () => stringifyIcs20PacketData(basePacket({ [field]: value })),
        'field_too_large',
      );
    }
  });

  it('enforces the packet limit even when every field is within its limit', () => {
    assertCodecError(
      () =>
        stringifyIcs20PacketData(
          basePacket({
            memo: 'm'.repeat(ICS20_CLASSIC_JSON_LIMITS.memoBytes),
          }),
        ),
      'packet_too_large',
    );
  });

  it('rejects raw packets above the packet limit before decoding', () => {
    assertCodecError(
      () => decodeIcs20ClassicPacketData(new Uint8Array(ICS20_CLASSIC_JSON_LIMITS.packetBytes + 1)),
      'packet_too_large',
    );
  });

  it('accepts canonical packet bytes exactly at the packet limit', () => {
    const packet = {
      denom: 'd'.repeat(200),
      amount: '1'.repeat(77),
      sender: 's'.repeat(100),
      receiver: 'r'.repeat(50),
      memo: 'm'.repeat(25),
    };
    const encoded = encodeIcs20ClassicPacketData(packet);

    assert.equal(encoded.byteLength, ICS20_CLASSIC_JSON_LIMITS.packetBytes);
    assert.deepEqual(decodeIcs20ClassicPacketData(encoded).data, packet);
  });

  it('rejects canonical emission when the combined packet exceeds its limit', () => {
    assertCodecError(
      () =>
        stringifyIcs20PacketData({
          denom: 'd'.repeat(ICS20_CLASSIC_JSON_LIMITS.denomBytes),
          amount: '1'.repeat(ICS20_CLASSIC_JSON_LIMITS.amountBytes),
          sender: 's'.repeat(ICS20_CLASSIC_JSON_LIMITS.senderBytes),
          receiver: 'r'.repeat(ICS20_CLASSIC_JSON_LIMITS.receiverBytes),
          memo: 'm'.repeat(ICS20_CLASSIC_JSON_LIMITS.memoBytes),
        }),
      'packet_too_large',
    );
  });
});
