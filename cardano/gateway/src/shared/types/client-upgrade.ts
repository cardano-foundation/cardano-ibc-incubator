import type { Data as PlutusData } from '@lucid-evolution/lucid';
import { ClientDatum, encodeClientDatum } from './client-datum';
import { ClientState } from './client-state-types';
import { ConsensusState } from './consensus-state';
import { MerkleProof } from './isc-23/merkle';
import {
  createConsensusStateSchema,
  createIcs23MerkleProofSchema,
  createTendermintClientStateSchema,
} from './schema-fragments';

export type ClientUpgrade = {
  client_state: ClientState;
  consensus_state: ConsensusState;
  proof_client: MerkleProof;
  proof_consensus: MerkleProof;
  history_siblings: string[];
};

export async function encodeClientUpgradeProof(
  input: ClientDatum,
  output: ClientDatum,
  upgrade: ClientUpgrade,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<string> {
  const { Data, Constr } = Lucid;
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);
  const schema = Data.Object({
    client_state: createTendermintClientStateSchema(Data),
    consensus_state: createConsensusStateSchema(Data),
    proof_client: MerkleProofSchema,
    proof_consensus: MerkleProofSchema,
    history_siblings: Data.Array(Data.Bytes()),
  });
  const [before, after] = await Promise.all([encodeClientDatum(input, Lucid), encodeClientDatum(output, Lucid)]);
  return Data.to<PlutusData>(
    new Constr(0, [
      new Constr(5, [
        Data.from(before),
        Data.from(after),
        Data.from(Data.to(upgrade, schema as unknown as ClientUpgrade)),
      ]),
      new Constr(1, []),
    ]),
    undefined,
    { canonical: true },
  );
}
