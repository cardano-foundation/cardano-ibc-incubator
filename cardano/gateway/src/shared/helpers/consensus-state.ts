/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConsensusState as ConsensusStateTendermint } from '@cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import { Timestamp } from '@cosmjs-types/src/google/protobuf/timestamp';
import { bytesFromBase64 } from '@cosmjs-types/src/helpers';
import { ConsensusState } from '../types/consesus-state';
import { Height } from '../types/height';

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
