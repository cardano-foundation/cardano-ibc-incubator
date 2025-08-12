import { KEY_CHANNEL_END_PREFIX, KEY_CHANNEL_PREFIX, KEY_PORT_PREFIX } from '../../constant';
import { AuthToken } from '../types/auth-token';
import { hashSha3_256, hexToBytes } from './hex';

export function getChannelIdByTokenName(tokenName: string, baseToken: AuthToken, prefix: string): string {
  const baseTokenPart = hashSha3_256(baseToken.policyId + baseToken.name).slice(0, 40);
  const prefixPart = hashSha3_256(prefix).slice(0, 8);
  const prefixFull = baseTokenPart + prefixPart;

  if (!tokenName.includes(prefixFull)) return '';
  const channelIdHex = tokenName.replaceAll(prefixFull, '');

  return Buffer.from(hexToBytes(channelIdHex)).toString();
}

export function getConnectionIdFromConnectionHops(channelHops: string): string {
  return Buffer.from(hexToBytes(channelHops)).toString();
}

export function channelPathForPacket(portId: string, channelId: string) {
  return `${KEY_PORT_PREFIX}/${portId}/${KEY_CHANNEL_PREFIX}/${channelId}`;
}

export function channelPath(portId: string, channelId: string): string {
  return `${KEY_CHANNEL_END_PREFIX}/${channelPathForPacket(portId, channelId)}`;
}
