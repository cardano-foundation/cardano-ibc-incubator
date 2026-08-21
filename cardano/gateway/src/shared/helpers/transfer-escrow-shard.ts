import { hashBlake2b224 } from './hex';
import { Data } from '@lucid-evolution/lucid';

const TRANSFER_ESCROW_SHARD_DOMAIN = 'cardano-ibc/transfer-escrow-shard/v1';
const TRANSFER_ESCROW_SHARD_REGISTRY_PREFIX = 'escrowShards/';
const TRANSFER_ESCROW_SHARD_CHANNEL_COUNT_PREFIX = 'escrowShardCounts/';
export const TRANSFER_ESCROW_SHARD_RETIRED_VALUE = Buffer.from([2]);
export const TRANSFER_ESCROW_SHARD_REGISTERED_VALUE = Buffer.from([1]);

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

export function transferEscrowShardTokenName(channelId: string, packetDenom: string): string {
  const channelBytes = decodeHexBytes(channelId, 'channelId');
  const denomBytes = decodeHexBytes(packetDenom, 'packetDenom');
  const preimage = Buffer.concat([
    Buffer.from(TRANSFER_ESCROW_SHARD_DOMAIN, 'utf8'),
    Buffer.from([0]),
    uint32BigEndian(channelBytes.length),
    channelBytes,
    uint32BigEndian(denomBytes.length),
    denomBytes,
  ]);
  return hashBlake2b224(preimage.toString('hex'));
}

export function transferEscrowShardRegistryKey(shardTokenName: string): string {
  if (!/^[0-9a-fA-F]{56}$/.test(shardTokenName)) {
    throw new Error('Escrow shard token name must be a 28-byte hexadecimal string');
  }
  return `${TRANSFER_ESCROW_SHARD_REGISTRY_PREFIX}${shardTokenName.toLowerCase()}`;
}

export function transferEscrowShardChannelLiveCountKey(channelId: string): string {
  const channelBytes = decodeHexBytes(channelId, 'channelId');
  return `${TRANSFER_ESCROW_SHARD_CHANNEL_COUNT_PREFIX}${channelBytes.toString('hex')}`;
}

export function transferEscrowShardCountValue(count: bigint): Buffer {
  if (count < 0n) {
    throw new Error('Escrow shard count cannot be negative');
  }
  return Buffer.from(
    Data.to(count as any, Data.Integer(), { canonical: true }),
    'hex',
  );
}

export function escrowDenomTokenFromPacketDenom(packetDenomHex: string): string {
  const packetDenomBytes = decodeHexBytes(packetDenomHex, 'packet denom datum');
  const packetDenom = packetDenomBytes.toString('utf8');
  if (!Buffer.from(packetDenom, 'utf8').equals(packetDenomBytes)) {
    throw new Error('Escrow shard packet denom is not canonical UTF-8');
  }
  if (packetDenom.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(packetDenom)) {
    throw new Error('Escrow shard packet denom must contain a hexadecimal asset unit');
  }

  const decodedUnit = Buffer.from(packetDenom, 'hex');
  if (decodedUnit.toString('utf8') === 'lovelace' && Buffer.from('lovelace').equals(decodedUnit)) {
    return 'lovelace';
  }
  if (packetDenom.length < 56 || packetDenom.length > 120) {
    throw new Error('Escrow shard packet denom does not encode a canonical Cardano asset unit');
  }
  return decodedUnit.toString('hex');
}
