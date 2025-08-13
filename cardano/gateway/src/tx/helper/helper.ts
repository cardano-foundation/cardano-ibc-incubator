import { ClientState, ConsensusState, Header } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { LOVELACE } from '../../constant';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { MerkleProof } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';
import {
  ClientState as ClientStateOuroboros,
  Misbehaviour,
} from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import { ClientState as ClientStateMithril } from '@plus/proto-types/build/ibc/lightclients/mithril/mithril';

export function normalizeDenomTokenTransfer(denom: string): string {
  denom = denom.trim();
  let result = denom;
  if (!denom) result = LOVELACE;

  return result;
}
export function decodeClientState(value: Uint8Array): ClientState {
  try {
    return ClientState.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding client state: ${error}`);
  }
}
export function decodeClientStateOuroboros(value: Uint8Array): ClientStateOuroboros {
  try {
    return ClientStateOuroboros.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding client state ouroboros: ${error}`);
  }
}

export function decodeClientStateMithril(value: Uint8Array): ClientStateMithril {
  try {
    return ClientStateMithril.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding client state mithril: ${error}`);
  }
}

export function decodeConsensusState(value: Uint8Array): ConsensusState {
  try {
    return ConsensusState.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding consensus state ouroboros: ${error}`);
  }
}

export function decodeMerkleProof(value: Uint8Array): MerkleProof {
  try {
    return MerkleProof.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding merkle proof: ${error}`);
  }
}
