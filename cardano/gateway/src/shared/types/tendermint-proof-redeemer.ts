import { ConsensusState } from './consensus-state';
import { Height } from './height';

type ClientInputReference = {
  transaction_id: string;
  output_index: bigint;
};

export type TendermintUpdateProofRedeemer = {
  client_input_ref: ClientInputReference;
  trusted_height: Height;
  new_height: Height;
  new_consensus_state: ConsensusState;
  proof_time: bigint;
  proof: string;
};

export type TendermintMisbehaviourProofRedeemer = {
  client_input_ref: ClientInputReference;
  trusted_height_1: Height;
  trusted_height_2: Height;
  proof_time: bigint;
  proof: string;
};

export type TendermintProofRedeemer =
  | { Update: TendermintUpdateProofRedeemer }
  | { Misbehaviour: TendermintMisbehaviourProofRedeemer };

export type TendermintProofRedeemerInput = TendermintProofRedeemer | TendermintUpdateProofRedeemer;

function schema(Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const ConsensusStateSchema = Data.Object({
    timestamp: Data.Integer(),
    next_validators_hash: Data.Bytes(),
    root: Data.Object({ hash: Data.Bytes() }),
  });

  const ClientInputReferenceSchema = Data.Object({
    transaction_id: Data.Bytes(),
    output_index: Data.Integer(),
  });

  return Data.Enum([
    Data.Object({
      Update: Data.Object({
        client_input_ref: ClientInputReferenceSchema,
        trusted_height: HeightSchema,
        new_height: HeightSchema,
        new_consensus_state: ConsensusStateSchema,
        proof_time: Data.Integer(),
        proof: Data.Bytes(),
      }),
    }),
    Data.Object({
      Misbehaviour: Data.Object({
        client_input_ref: ClientInputReferenceSchema,
        trusted_height_1: HeightSchema,
        trusted_height_2: HeightSchema,
        proof_time: Data.Integer(),
        proof: Data.Bytes(),
      }),
    }),
  ]);
}

export function encodeTendermintProofRedeemer(
  redeemer: TendermintProofRedeemerInput,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string {
  const RedeemerSchema = schema(Lucid);
  const taggedRedeemer: TendermintProofRedeemer =
    'Update' in redeemer || 'Misbehaviour' in redeemer ? redeemer : { Update: redeemer };
  return Lucid.Data.to(taggedRedeemer, RedeemerSchema as unknown as TendermintProofRedeemer, { canonical: true });
}

export function decodeTendermintProofRedeemer(
  encoded: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): TendermintProofRedeemer {
  const RedeemerSchema = schema(Lucid);
  return Lucid.Data.from(encoded, RedeemerSchema as unknown as TendermintProofRedeemer);
}
