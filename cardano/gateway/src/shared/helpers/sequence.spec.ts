import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from './sequence';

describe('IBC identifier sequence parsing', () => {
  it('accepts canonical identifiers', () => {
    expect(parseClientSequence('07-tendermint-0')).toBe('0');
    expect(parseClientSequence('08-cardano-probabilistic-42')).toBe('42');
    expect(parseConnectionSequence('connection-0')).toBe(0n);
    expect(parseConnectionSequence('connection-42')).toBe(42n);
    expect(parseChannelSequence('channel-0')).toBe(0n);
    expect(parseChannelSequence('channel-42')).toBe(42n);
  });

  it.each([
    ['07-tendermint-00', parseClientSequence],
    ['07-tendermint-01', parseClientSequence],
    ['connection-00', parseConnectionSequence],
    ['connection-01', parseConnectionSequence],
    ['connection-', parseConnectionSequence],
    ['channel-00', parseChannelSequence],
    ['channel-01', parseChannelSequence],
    ['channel- 1', parseChannelSequence],
  ])('rejects non-canonical identifier %s', (identifier, parse) => {
    expect(() => parse(identifier)).toThrow(/invalid/i);
  });
});
