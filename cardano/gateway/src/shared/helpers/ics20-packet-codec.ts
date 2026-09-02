import {
  decodeIcs20ClassicPacketData,
  type Ics20ClassicJsonProfile,
  type Ics20ClassicPacketData,
  stringifyIcs20PacketData,
  stringifyLegacyIcs20PacketData,
} from '@cardano-ibc/tx-builder';
import { ICS20_PACKET_CODEC, type Ics20PacketCodec } from '../../config/bridge-manifest';

export type GatewayIcs20JsonProfile = Ics20ClassicJsonProfile | 'legacy-cardano-json';

export type GatewayDecodedIcs20PacketData = {
  data: Required<Ics20ClassicPacketData>;
  profiles: readonly GatewayIcs20JsonProfile[];
  json: string;
};

function decodeLegacyPacketData(packetBytes: Uint8Array): GatewayDecodedIcs20PacketData {
  const json = Buffer.from(packetBytes).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('ICS-20 packet data is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ICS-20 packet data must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  for (const field of ['denom', 'amount', 'sender', 'receiver'] as const) {
    if (typeof record[field] !== 'string') {
      throw new Error(`ICS-20 packet data field "${field}" must be a string`);
    }
  }
  if (record.memo !== undefined && typeof record.memo !== 'string') {
    throw new Error('ICS-20 packet data field "memo" must be a string');
  }

  return {
    data: {
      denom: record.denom,
      amount: record.amount,
      sender: record.sender,
      receiver: record.receiver,
      memo: record.memo ?? '',
    } as Required<Ics20ClassicPacketData>,
    profiles: ['legacy-cardano-json'],
    json,
  };
}

export function decodeIcs20PacketDataForCodec(
  packetBytes: Uint8Array,
  codec: Ics20PacketCodec,
): GatewayDecodedIcs20PacketData {
  if (codec === ICS20_PACKET_CODEC.LEGACY) {
    return decodeLegacyPacketData(packetBytes);
  }
  return decodeIcs20ClassicPacketData(packetBytes);
}

export function stringifyIcs20PacketDataForCodec(
  packetData: Ics20ClassicPacketData,
  codec: Ics20PacketCodec,
): string {
  return codec === ICS20_PACKET_CODEC.LEGACY
    ? stringifyLegacyIcs20PacketData(packetData)
    : stringifyIcs20PacketData(packetData);
}

export { stringifyLegacyIcs20PacketData };
