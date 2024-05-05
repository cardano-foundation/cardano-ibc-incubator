import { KEY_CONNECTION_PREFIX } from '../../constant';
import { AuthToken } from '../types/auth-token';
import { hashSha3_256, hexToBytes } from './hex';

export function getConnectionIdByTokenName(tokenName: string, baseToken: AuthToken, prefix: string): string {
  const baseTokenPart = hashSha3_256(baseToken.policyId + baseToken.name).slice(0, 40);
  const prefixPart = hashSha3_256(prefix).slice(0, 8);
  const prefixFull = baseTokenPart + prefixPart;

  if (!tokenName.includes(prefixFull)) return '';
  const connIdHex = tokenName.replaceAll(prefixFull, '');

  return Buffer.from(hexToBytes(connIdHex)).toString();
}

export function connectionPath(connectionId: string): string {
  return `${KEY_CONNECTION_PREFIX}/${connectionId}`;
}
