import { UTxO } from '@lucid-evolution/lucid';
import { ClientState, ConsensusState, Header } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { LOVELACE } from '../../constant';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { MerkleProof } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';
import { ClientState as ClientStateMithril } from '@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril';

export function normalizeDenomTokenTransfer(denom: string): string {
  denom = denom.trim();
  let result = denom;
  if (!denom) result = LOVELACE;

  return result;
}

export function mapLovelaceDenom(
  denom: string,
  direction: 'asset_to_packet' | 'packet_to_asset',
): string {
  const normalizedDenom = normalizeDenomTokenTransfer(denom);
  const lowerDenom = normalizedDenom.toLowerCase();
  const lovelacePacketDenom = Buffer.from(LOVELACE, 'utf8').toString('hex');

  if (direction === 'asset_to_packet') {
    return lowerDenom === LOVELACE ? lovelacePacketDenom : normalizedDenom;
  }

  return lowerDenom === lovelacePacketDenom || lowerDenom === LOVELACE ? LOVELACE : normalizedDenom;
}

// Sum lovelace across wallet UTxOs so wallet-context logs can show available ADA.
export function sumLovelaceFromUtxos(utxos: UTxO[]): bigint {
  let total = 0n;
  for (const utxo of utxos) {
    const lovelace = (utxo.assets as any)?.lovelace;
    if (typeof lovelace === 'bigint') {
      total += lovelace;
    }
  }
  return total;
}

export function decodeClientState(value: Uint8Array): ClientState {
  try {
    return ClientState.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding client state: ${error}`);
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
    throw new GrpcInvalidArgumentException(`Error decoding consensus state: ${error}`);
  }
}

export function decodeMerkleProof(value: Uint8Array): MerkleProof {
  try {
    return MerkleProof.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding merkle proof: ${error}`);
  }
}
