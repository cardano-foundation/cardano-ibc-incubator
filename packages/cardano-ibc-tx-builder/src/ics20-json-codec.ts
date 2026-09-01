export const ICS20_CLASSIC_JSON_LIMITS = Object.freeze({
  packetBytes: 512,
  denomBytes: 256,
  amountBytes: 78,
  senderBytes: 256,
  receiverBytes: 256,
  memoBytes: 512,
});

export type Ics20ClassicPacketData = {
  denom: string;
  amount: string;
  sender: string;
  receiver: string;
  memo?: string;
};

export type Ics20ClassicJsonProfile = 'cardano-js-sorted' | 'ibc-go-v8-sorted' | 'ibc-go-v10';

export type DecodedIcs20ClassicPacketData = {
  data: Required<Ics20ClassicPacketData>;
  profiles: readonly Ics20ClassicJsonProfile[];
  json: string;
};

export type Ics20ClassicJsonCodecErrorCode =
  | 'packet_too_large'
  | 'invalid_utf8'
  | 'malformed_json'
  | 'invalid_shape'
  | 'field_too_large'
  | 'non_canonical';

export class Ics20ClassicJsonCodecError extends Error {
  constructor(
    public readonly code: Ics20ClassicJsonCodecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Ics20ClassicJsonCodecError';
  }
}

const REQUIRED_KEYS = ['denom', 'amount', 'sender', 'receiver'] as const;
const ALLOWED_KEYS = new Set<string>([...REQUIRED_KEYS, 'memo']);
const CARDANO_AND_IBC_GO_V8_ORDER = ['amount', 'denom', 'memo', 'receiver', 'sender'] as const;
const IBC_GO_V10_ORDER = ['denom', 'amount', 'sender', 'receiver', 'memo'] as const;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', {
  fatal: true,
  // Keep a leading BOM in the decoded string so it cannot disappear before
  // the exact canonical-byte check.
  ignoreBOM: true,
});

type RequiredPacketData = Required<Ics20ClassicPacketData>;
type PacketField = keyof RequiredPacketData;

const FIELD_LIMITS: Readonly<Record<PacketField, number>> = {
  denom: ICS20_CLASSIC_JSON_LIMITS.denomBytes,
  amount: ICS20_CLASSIC_JSON_LIMITS.amountBytes,
  sender: ICS20_CLASSIC_JSON_LIMITS.senderBytes,
  receiver: ICS20_CLASSIC_JSON_LIMITS.receiverBytes,
  memo: ICS20_CLASSIC_JSON_LIMITS.memoBytes,
};

function codecError(
  code: Ics20ClassicJsonCodecErrorCode,
  message: string,
): Ics20ClassicJsonCodecError {
  return new Ics20ClassicJsonCodecError(code, message);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validatePacketData(value: unknown): RequiredPacketData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw codecError('invalid_shape', 'ICS-20 packet data must be a JSON object');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const unknownKey = keys.find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey !== undefined) {
    throw codecError('invalid_shape', `ICS-20 packet data contains unknown field "${unknownKey}"`);
  }

  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw codecError('invalid_shape', `ICS-20 packet data is missing required field "${key}"`);
    }
  }

  const hasMemo = Object.prototype.hasOwnProperty.call(record, 'memo');
  if (hasMemo && record.memo !== undefined && typeof record.memo !== 'string') {
    throw codecError('invalid_shape', 'ICS-20 packet data field "memo" must be a string');
  }

  for (const key of REQUIRED_KEYS) {
    if (typeof record[key] !== 'string') {
      throw codecError('invalid_shape', `ICS-20 packet data field "${key}" must be a string`);
    }
    if (record[key].length === 0) {
      throw codecError('invalid_shape', `ICS-20 packet data field "${key}" must not be empty`);
    }
  }

  const packet: RequiredPacketData = {
    denom: record.denom as string,
    amount: record.amount as string,
    sender: record.sender as string,
    receiver: record.receiver as string,
    memo: hasMemo ? ((record.memo as string | undefined) ?? '') : '',
  };

  for (const key of Object.keys(FIELD_LIMITS) as PacketField[]) {
    const fieldValue = packet[key];
    if (hasUnpairedSurrogate(fieldValue)) {
      throw codecError(
        'invalid_utf8',
        `ICS-20 packet data field "${key}" contains an invalid Unicode surrogate`,
      );
    }

    const byteLength = UTF8_ENCODER.encode(fieldValue).byteLength;
    if (byteLength > FIELD_LIMITS[key]) {
      throw codecError(
        'field_too_large',
        `ICS-20 packet data field "${key}" exceeds ${FIELD_LIMITS[key]} UTF-8 bytes`,
      );
    }
  }

  return packet;
}

function packetInOrder(
  packet: RequiredPacketData,
  order: readonly PacketField[],
): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const key of order) {
    if (key !== 'memo' || packet.memo !== '') ordered[key] = packet[key];
  }
  return ordered;
}

function stringifyCardanoPacket(packet: RequiredPacketData): string {
  return JSON.stringify(packetInOrder(packet, CARDANO_AND_IBC_GO_V8_ORDER));
}

function quoteGoJsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function stringifyGoPacket(packet: RequiredPacketData, order: readonly PacketField[]): string {
  const fields: string[] = [];
  for (const key of order) {
    if (key === 'memo' && packet.memo === '') continue;
    fields.push(`${JSON.stringify(key)}:${quoteGoJsonString(packet[key])}`);
  }
  return `{${fields.join(',')}}`;
}

function ensurePacketSize(json: string): void {
  const byteLength = UTF8_ENCODER.encode(json).byteLength;
  if (byteLength > ICS20_CLASSIC_JSON_LIMITS.packetBytes) {
    throw codecError(
      'packet_too_large',
      `ICS-20 packet data exceeds ${ICS20_CLASSIC_JSON_LIMITS.packetBytes} bytes`,
    );
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

/** Emit Cardano's existing sorted JavaScript JSON representation. */
export function stringifyIcs20PacketData(packetData: Ics20ClassicPacketData): string {
  const packet = validatePacketData(packetData);
  const json = stringifyCardanoPacket(packet);
  ensurePacketSize(json);
  return json;
}

/** Emit Cardano's existing sorted JavaScript JSON representation as UTF-8. */
export function encodeIcs20ClassicPacketData(packetData: Ics20ClassicPacketData): Uint8Array {
  return UTF8_ENCODER.encode(stringifyIcs20PacketData(packetData));
}

/**
 * Decode only the canonical packet bytes emitted by Cardano, ibc-go v8, or
 * ibc-go v10. More than one profile can match when their bytes are identical.
 */
export function decodeIcs20ClassicPacketData(
  packetBytes: Uint8Array,
): DecodedIcs20ClassicPacketData {
  if (!(packetBytes instanceof Uint8Array)) {
    throw codecError('invalid_shape', 'ICS-20 packet data must be bytes');
  }
  if (packetBytes.byteLength > ICS20_CLASSIC_JSON_LIMITS.packetBytes) {
    throw codecError(
      'packet_too_large',
      `ICS-20 packet data exceeds ${ICS20_CLASSIC_JSON_LIMITS.packetBytes} bytes`,
    );
  }

  let json: string;
  try {
    json = UTF8_DECODER.decode(packetBytes);
  } catch {
    throw codecError('invalid_utf8', 'ICS-20 packet data is not valid UTF-8');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw codecError('malformed_json', 'ICS-20 packet data is not valid JSON');
  }

  const packet = validatePacketData(parsed);
  const candidates: ReadonlyArray<readonly [Ics20ClassicJsonProfile, string]> = [
    ['cardano-js-sorted', stringifyCardanoPacket(packet)],
    ['ibc-go-v8-sorted', stringifyGoPacket(packet, CARDANO_AND_IBC_GO_V8_ORDER)],
    ['ibc-go-v10', stringifyGoPacket(packet, IBC_GO_V10_ORDER)],
  ];
  const profiles = candidates
    .filter(
      ([, candidate]) =>
        candidate === json && bytesEqual(UTF8_ENCODER.encode(candidate), packetBytes),
    )
    .map(([profile]) => profile);

  if (profiles.length === 0) {
    throw codecError(
      'non_canonical',
      'ICS-20 packet data does not use a supported canonical JSON encoding',
    );
  }

  return { data: packet, profiles, json };
}
