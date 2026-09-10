import type { AuthToken } from './auth-token';
import type { ConsensusState } from './consensus-state';
import type { Height } from './height';
import type { ClientDatum } from './client-datum';
import { getHeightMapValue } from '../helpers/verify';

/** A previous tip authenticated by the history root in its client's NFT datum. */
export type ConsensusStateDatum = {
  clientToken: AuthToken;
  height: Height;
  consensusState: ConsensusState;
  processedTime: bigint;
  processedHeight: bigint;
};

type LucidModule = typeof import('@lucid-evolution/lucid');

export function consensusStateDatumSchema({ Data }: LucidModule) {
  return Data.Object({
    clientToken: Data.Object({ policyId: Data.Bytes(), name: Data.Bytes() }),
    height: Data.Object({ revisionNumber: Data.Integer(), revisionHeight: Data.Integer() }),
    consensusState: Data.Object({
      timestamp: Data.Integer(),
      next_validators_hash: Data.Bytes(),
      root: Data.Object({ hash: Data.Bytes() }),
    }),
    processedTime: Data.Integer(),
    processedHeight: Data.Integer(),
  });
}

export type ConsensusHistoryWitness = {
  record: ConsensusStateDatum;
  siblings: string[];
};

export function consensusHistoryWitnessSchema(Lucid: LucidModule) {
  return Lucid.Data.Object({
    record: consensusStateDatumSchema(Lucid),
    siblings: Lucid.Data.Array(Lucid.Data.Bytes()),
  });
}

export function encodeConsensusStateDatum(datum: ConsensusStateDatum, Lucid: LucidModule): string {
  return Lucid.Data.to(datum as never, consensusStateDatumSchema(Lucid) as never, { canonical: true });
}

export function decodeConsensusStateDatum(encoded: string, Lucid: LucidModule): ConsensusStateDatum {
  return Lucid.Data.from(encoded, consensusStateDatumSchema(Lucid) as never) as ConsensusStateDatum;
}

export function latestConsensusStateDatum(client: ClientDatum): ConsensusStateDatum {
  const height = client.state.clientState.latestHeight;
  const consensusState = getHeightMapValue(client.state.consensusStates, height);
  const processedTime = getHeightMapValue(client.state.processedTimes, height);
  const processedHeight = getHeightMapValue(client.state.processedHeights, height);
  if (consensusState === undefined || processedTime === undefined || processedHeight === undefined) {
    throw new Error('Client latest consensus state is missing state or processed metadata');
  }
  return { clientToken: client.token, height, consensusState, processedTime, processedHeight };
}

/** Preserve the ClientDatum ABI while writing only its latest consensus state. */
export function latestOnlyClientDatum(client: ClientDatum): ClientDatum {
  const latest = latestConsensusStateDatum(client);
  return {
    ...client,
    state: {
      ...client.state,
      consensusStates: new Map([[latest.height, latest.consensusState]]),
      processedTimes: new Map([[latest.height, latest.processedTime]]),
      processedHeights: new Map([[latest.height, latest.processedHeight]]),
    },
  };
}
