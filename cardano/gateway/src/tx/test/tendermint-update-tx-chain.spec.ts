import { BinaryReader } from '@cardano-ibc/proto-types/build/binary';
import {
  encodeTendermintUpdateTxChain,
  MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH,
  TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL,
  TENDERMINT_UPDATE_TX_CHAIN_VERSION,
} from '../tendermint-update-tx-chain';

describe('Tendermint update transaction chain envelope', () => {
  it('encodes a versioned, dependency-ordered chain', () => {
    const encoded = encodeTendermintUpdateTxChain(['A100', 'b200']);
    const reader = new BinaryReader(encoded);

    expect(TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL).toBe('/ibc.cardano.v1.TendermintUpdateTxChain');
    expect(reader.uint32()).toBe(8);
    expect(reader.uint32()).toBe(TENDERMINT_UPDATE_TX_CHAIN_VERSION);
    expect(reader.uint32()).toBe(18);
    expect(reader.string()).toBe('a100');
    expect(reader.uint32()).toBe(18);
    expect(reader.string()).toBe('b200');
    expect(reader.pos).toBe(reader.len);
  });

  it('marks a tree-neutral phase for rebuild after its final confirmation', () => {
    const reader = new BinaryReader(
      encodeTendermintUpdateTxChain(['a100'], {
        rebuildAfterSubmission: true,
      }),
    );

    expect(reader.uint32()).toBe(8);
    expect(reader.uint32()).toBe(1);
    expect(reader.uint32()).toBe(18);
    expect(reader.string()).toBe('a100');
    expect(reader.uint32()).toBe(24);
    expect(reader.bool()).toBe(true);
    expect(reader.pos).toBe(reader.len);
  });

  it('accepts the strict maximum chain length', () => {
    expect(() =>
      encodeTendermintUpdateTxChain(Array.from({ length: MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH }, () => 'a100')),
    ).not.toThrow();
  });

  it('rejects an empty chain', () => {
    expect(() => encodeTendermintUpdateTxChain([])).toThrow('chain length');
  });

  it('rejects a chain over the strict maximum', () => {
    expect(() =>
      encodeTendermintUpdateTxChain(Array.from({ length: MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH + 1 }, () => 'a100')),
    ).toThrow('chain length');
  });

  it.each(['', 'abc', 'zz'])('rejects malformed CBOR hex %p', (cbor) => {
    expect(() => encodeTendermintUpdateTxChain([cbor])).toThrow('Invalid unsigned transaction CBOR hex');
  });
});
