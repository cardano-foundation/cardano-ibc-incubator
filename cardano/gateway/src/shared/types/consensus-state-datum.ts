import { createHash } from 'node:crypto';
import type { AuthToken } from './auth-token';
import type { ConsensusState } from './consensus-state';
import type { Height } from './height';
import type { ClientDatum } from './client-datum';
import { getHeightMapValue } from '../helpers/verify';

/** A previous tip, authenticated by its client policy and deterministic key NFT. */
export type ConsensusStateDatum = {
  clientToken: AuthToken;
  height: Height;
  consensusState: ConsensusState;
  processedTime: bigint;
  processedHeight: bigint;
};

type LucidModule = typeof import('@lucid-evolution/lucid');

function consensusStateDatumSchema({ Data }: LucidModule) {
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

export function encodeConsensusStateDatum(datum: ConsensusStateDatum, Lucid: LucidModule): string {
  return Lucid.Data.to(datum as never, consensusStateDatumSchema(Lucid) as never, { canonical: true });
}

export function decodeConsensusStateDatum(encoded: string, Lucid: LucidModule): ConsensusStateDatum {
  return Lucid.Data.from(encoded, consensusStateDatumSchema(Lucid) as never) as ConsensusStateDatum;
}

/** SHA3-256(serialise_data(ConsensusStateKey { client_token, height })). */
export function consensusStateTokenName(clientToken: AuthToken, height: Height, Lucid: LucidModule): string {
  const { Data } = Lucid;
  const schema = Data.Object({
    clientToken: Data.Object({ policyId: Data.Bytes(), name: Data.Bytes() }),
    height: Data.Object({ revisionNumber: Data.Integer(), revisionHeight: Data.Integer() }),
  });
  // Aiken's serialise_data uses ledger CBOR (indefinite constructor lists),
  // not Lucid's canonical:true definite-list representation. Hash the exact
  // ledger bytes, as with the existing IBC commitment encoders.
  const key = Data.to({ clientToken, height } as never, schema as never, { canonical: false });
  return createHash('sha3-256').update(Buffer.from(key, 'hex')).digest('hex');
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
