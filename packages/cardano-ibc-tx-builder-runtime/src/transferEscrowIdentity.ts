import { Buffer } from 'node:buffer';
import { blake2b } from '@noble/hashes/blake2b';

const TRANSFER_ESCROW_SHARD_NAME_DOMAIN = Buffer.from(
  'cardano-ibc/transfer-escrow-shard/v1',
  'utf8',
);
const UINT32_MAX = 0xffff_ffff;

function decodeHexBytes(value: string, label: string): Buffer {
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be an even-length hexadecimal string`);
  }
  return Buffer.from(value, 'hex');
}

function uint32BigEndian(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`Escrow shard framing length ${value} exceeds uint32`);
  }
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

export function transferEscrowShardTokenName(
  channelId: string,
  packetDenom: string,
): string {
  const channelBytes = decodeHexBytes(channelId, 'channelId');
  const denomBytes = decodeHexBytes(packetDenom, 'packetDenom');
  return Buffer.from(
    blake2b(
      Buffer.concat([
        TRANSFER_ESCROW_SHARD_NAME_DOMAIN,
        Buffer.from([0]),
        uint32BigEndian(channelBytes.length),
        channelBytes,
        uint32BigEndian(denomBytes.length),
        denomBytes,
      ]),
      { dkLen: 28 },
    ),
  ).toString('hex');
}

export function transferEscrowShardRegistryKey(tokenName: string): string {
  if (!/^[0-9a-fA-F]{56}$/.test(tokenName)) {
    throw new Error('Escrow shard token name must be a 28-byte hexadecimal string');
  }
  return `escrowShards/${tokenName.toLowerCase()}`;
}

export function escrowDenomTokenFromPacketDenom(encodedDenom: string): string {
  const packetDenomBytes = decodeHexBytes(encodedDenom, 'transfer escrow shard datum denom');
  const packetDenom = packetDenomBytes.toString('utf8');
  if (!Buffer.from(packetDenom, 'utf8').equals(packetDenomBytes)) {
    throw new Error('Transfer escrow shard datum denom is not canonical UTF-8');
  }
  if (packetDenom.toLowerCase() === Buffer.from('lovelace').toString('hex')) {
    return 'lovelace';
  }
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(packetDenom)) {
    throw new Error('Transfer escrow shard datum contains a non-hex denomination');
  }
  if (packetDenom.length < 56 || packetDenom.length > 120) {
    throw new Error('Transfer escrow shard datum contains an invalid Cardano asset unit');
  }
  return packetDenom.toLowerCase();
}
