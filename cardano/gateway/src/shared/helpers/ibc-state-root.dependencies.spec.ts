import {
  computeRootWithCreateClientUpdate,
  computeRootWithCreateConnectionUpdate,
  decodeDependencyCount,
  encodeDependencyCount,
  resetTreeState,
} from './ibc-state-root';
import { Data } from '@lucid-evolution/lucid';

describe('IBC dependency-count root updates', () => {
  beforeEach(() => resetTreeState());

  it('initializes a client count and increments it with each connection', () => {
    const client = computeRootWithCreateClientUpdate(
      '0'.repeat(64),
      '07-tendermint-0',
      Buffer.from('client'),
      Buffer.from('consensus'),
      10n,
    );
    expect(client.clientConnectionCountSiblings).toHaveLength(64);
    client.commit();

    const first = computeRootWithCreateConnectionUpdate(
      client.newRoot,
      'connection-0',
      Buffer.from('connection-0'),
      '07-tendermint-0',
    );
    expect(first.clientConnectionCount).toBe(0n);
    expect(first.clientConnectionCountSiblings).toHaveLength(64);
    first.commit();

    const second = computeRootWithCreateConnectionUpdate(
      first.newRoot,
      'connection-1',
      Buffer.from('connection-1'),
      '07-tendermint-0',
    );
    expect(second.clientConnectionCount).toBe(1n);
  });

  it.each([0n, 23n, 24n, 255n, 256n, 65_535n, 65_536n, 4_294_967_296n])(
    'round-trips canonical count %s',
    (count) => {
      const encoded = encodeDependencyCount(count);
      expect(decodeDependencyCount(encoded)).toBe(count);
      expect(encoded.toString('hex')).toBe(Data.to(count as any, Data.Integer() as any));
    },
  );

  it('rejects connection creation when its client count leaf is missing', () => {
    expect(() =>
      computeRootWithCreateConnectionUpdate(
        '0'.repeat(64),
        'connection-0',
        Buffer.from('connection'),
        '07-tendermint-0',
      ),
    ).toThrow("missing the live-connection count for '07-tendermint-0'");
  });
});
