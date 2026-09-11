import { ConsensusState as ProtoConsensusState } from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { ConsensusState } from '../types/consensus-state';
import { Height } from '../types/height';
import { initializeConsensusState, normalizeConsensusStateFromDatum } from './consensus-state';

describe('consensus state timestamps', () => {
  const height: Height = { revisionNumber: 0n, revisionHeight: 10n };
  const cases: [string, bigint, bigint, number][] = [
    ['one nanosecond', 1n, 0n, 1],
    ['below half a second', 499_999_999n, 0n, 499_999_999],
    ['half a second', 500_000_000n, 0n, 500_000_000],
    ['below a whole second', 999_999_999n, 0n, 999_999_999],
    ['a whole second', 1_000_000_000n, 1n, 0],
    ['above a whole second', 1_000_000_001n, 1n, 1],
    ['the reported 1000.7 second example', 1_000_700_000_000n, 1_000n, 700_000_000],
    ['epoch nanoseconds above Number.MAX_SAFE_INTEGER', 1_750_000_000_123_456_789n, 1_750_000_000n, 123_456_789],
    ['epoch nanoseconds just below a whole second', 1_750_000_000_999_999_999n, 1_750_000_000n, 999_999_999],
    ['the largest protobuf timestamp', 253_402_300_799_999_999_999n, 253_402_300_799n, 999_999_999],
  ];

  function datum(timestamp: bigint): ConsensusState {
    return {
      timestamp,
      root: { hash: 'ab'.repeat(32) },
      next_validators_hash: 'cd'.repeat(32),
    };
  }

  it.each(cases)('preserves %s when querying a consensus state', (_name, timestamp, seconds, nanos) => {
    const normalized = normalizeConsensusStateFromDatum(new Map([[height, datum(timestamp)]]), height.revisionHeight);

    expect(normalized.timestamp).toEqual({ seconds, nanos });
  });

  it.each(cases)('round-trips %s through protobuf without changing the datum', (_name, timestamp) => {
    const original = datum(timestamp);
    const normalized = normalizeConsensusStateFromDatum(new Map([[height, original]]), height.revisionHeight);
    const encoded = ProtoConsensusState.encode(normalized).finish();
    const decoded = ProtoConsensusState.decode(encoded);

    expect(initializeConsensusState(decoded)).toEqual(original);
  });
});
