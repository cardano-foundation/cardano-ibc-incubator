/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConsensusState as ConsensusStateTendermint } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { Timestamp } from '@plus/proto-types/build/google/protobuf/timestamp';
import { ConsensusState } from '../types/consensus-state';
import { Height } from '../types/height';
import { fromHex, toHex } from './hex';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';

export function normalizeConsensusStateFromDatum(
  consensusStateDatum: Map<Height, ConsensusState>,
  requestHeight: bigint,
): ConsensusStateTendermint {
  let consensusState: ConsensusState;

  for (const [height, consensusState_] of consensusStateDatum.entries()) {
    if (height.revisionHeight == requestHeight) {
      consensusState = consensusState_;
    }
  }
  if (!consensusState) throw new GrpcNotFoundException(`Unable to find Consensus State at height ${requestHeight}`); // Return undefined if no matching entry is found
  const consensus: ConsensusStateTendermint = {
    timestamp: Timestamp.fromPartial({
      seconds: BigInt(Math.round(Number(consensusState.timestamp) / 1e9)),
      nanos: Number(consensusState.timestamp) % 1e9,
    }),
    /** commitment root (i.e app hash) */
    root: {
      hash: fromHex(consensusState.root.hash),
    },
    next_validators_hash: fromHex(consensusState.next_validators_hash),
  } as unknown as ConsensusStateTendermint;
  return consensus;
}
// Convert consensus state operator to a structured ConsensusState object to submit to cardano
export function initializeConsensusState(consensusStateMsg: ConsensusStateTendermint): ConsensusState {
  if (!consensusStateMsg.timestamp) {
    throw new GrpcInvalidArgumentException('consensus_state.timestamp is required');
  }

  const timestampSeconds = BigInt(consensusStateMsg.timestamp.seconds ?? 0);
  const timestampNanos = BigInt(consensusStateMsg.timestamp.nanos ?? 0);
  const timestamp = timestampSeconds * 10n ** 9n + timestampNanos;

  if (timestamp <= 0n) {
    throw new GrpcInvalidArgumentException('consensus_state.timestamp must be a positive Unix time');
  }

  const consensusState: ConsensusState = {
    // Tendermint consensus state timestamps are nanoseconds since Unix epoch.
    // This must come from the counterparty chain header, not local wall-clock time,
    // otherwise UpdateClient header verification will fail.
    timestamp,
    next_validators_hash: toHex(consensusStateMsg.next_validators_hash),
    root: { hash: toHex(consensusStateMsg.root.hash) },
  };

  return consensusState;
}
// Validate the structure and values of the consensus state
export function validateConsensusState(consensusState: ConsensusState): GrpcInvalidArgumentException {
  if (consensusState.root?.hash?.length === 0) {
    return new GrpcInvalidArgumentException('root cannot be empty');
  }
  //tm hash size defined at: https://pkg.go.dev/github.com/cometbft/cometbft@v0.38.2/crypto/tmhash
  // const tmHashSize = 20;
  // if (consensusState.next_validators_hash?.length > 0 && consensusState.next_validators_hash?.length !== tmHashSize) {
  //   return new GrpcInvalidArgumentException(
  //     `Expected size to be ${tmHashSize} bytes, got ${consensusState.next_validators_hash.length} bytes`,
  //   );
  // }
  if (consensusState.timestamp <= 0) {
    return new GrpcInvalidArgumentException('timestamp must be a positive Unix time');
  }
  return null;
}
