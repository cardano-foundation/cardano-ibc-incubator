export function parseClientSequence(clientId: string): string {
  const fragments = clientId.split('-');

  if (fragments.length < 2) throw new Error('Invalid client id format');

  // IBC client identifiers are of the form `{client_type}-{sequence}`.
  //
  // Examples:
  // - `07-tendermint-12`
  // - `08-cardano-probabilistic-5`
  //
  // Historically this code used a Cardano-specific `ibc_client-{sequence}` format.
  // We now accept the canonical IBC client id format used by Hermes and ibc-go.
  const sequence = fragments.pop()!;
  const clientType = fragments.join('-');

  if (!clientType) throw new Error('Invalid client id format');

  if (!/^(?:0|[1-9]\d*)$/.test(sequence)) {
    throw new Error('Invalid client id format');
  }

  return sequence;
}

export function parseConnectionSequence(connectionId: string): bigint {
  const match = /^connection-(0|[1-9]\d*)$/.exec(connectionId);
  if (!match) {
    throw new Error('Invalid connection id format');
  }
  return BigInt(match[1]);
}

export function parseChannelSequence(channelId: string): bigint {
  const match = /^channel-(0|[1-9]\d*)$/.exec(channelId);
  if (!match) {
    throw new Error('Invalid channel id format');
  }
  return BigInt(match[1]);
}
