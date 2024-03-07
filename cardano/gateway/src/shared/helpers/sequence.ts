export function parseClientSequence(clientId: string): string {
  const fragments = clientId.split('-');

  if (fragments.length < 2) throw new Error('Invalid client id format');

  if (!(fragments.slice(0, -1).join('') === 'ibc_client')) {
    throw new Error('Invalid client id format');
  }

  return fragments.pop()!;
}

export function parseConnectionSequence(connectionId: string): bigint {
  const fragments = connectionId.split('-');

  if (fragments.length != 2) throw new Error('Invalid connection id format');

  if (!(fragments.slice(0, -1).join('') === 'connection')) {
    throw new Error('Invalid connection id format');
  }

  return BigInt(fragments.pop()!);
}
