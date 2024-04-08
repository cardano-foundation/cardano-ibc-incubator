/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConsensusState as ConsensusStateTendermint } from '@cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import { Timestamp } from '@cosmjs-types/src/google/protobuf/timestamp';
import { bytesFromBase64 } from '@cosmjs-types/src/helpers';
import { ConsensusState } from '../types/consensus-state';
import { Height } from '../types/height';
import { toHex } from './hex';
import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';

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
  if (!consensusState) return undefined; // Return undefined if no matching entry is found
  const consensus: ConsensusStateTendermint = {
    timestamp: Timestamp.fromPartial({
      seconds: BigInt(Math.round(Number(consensusState.timestamp) / 1e9)),
      nanos: Number(consensusState.timestamp) % 1e9,
    }),
    /** commitment root (i.e app hash) */
    root: {
      hash: bytesFromBase64(consensusState.root.hash),
    },
    next_validators_hash: bytesFromBase64(consensusState.next_validators_hash),
  } as unknown as ConsensusStateTendermint;
  return consensus;
}
// Convert consensus state operator to a structured ConsensusState object to submit to cardano
export function initializeConsensusState(consensusStateMsg: ConsensusStateTendermint): ConsensusState {
  const consensusState: ConsensusState = {
    // timestamp: BigInt(Date.now()) * 10n ** 6n,
    timestamp:
      BigInt(consensusStateMsg.timestamp.seconds) * BigInt(1e9) + BigInt(consensusStateMsg.timestamp.nanos || 0n) ??
      null,
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
