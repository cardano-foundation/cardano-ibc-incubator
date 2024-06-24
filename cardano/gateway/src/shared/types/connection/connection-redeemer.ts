import { AuthToken } from '../auth-token';
import { Data } from '@dinhbx/lucid-custom';
import { Height } from '../height';
import { MerkleProof } from '../isc-23/merkle';
import { CardanoClientState } from '../cardano';
import { MithrilClientState } from '../mithril';

export type MintConnectionRedeemer =
  | {
      ConnOpenInit: {
        handler_auth_token: AuthToken;
      };
    }
  | {
      ConnOpenTry: {
        handler_auth_token: AuthToken;
        client_state: MithrilClientState;
        proof_init: MerkleProof;
        proof_client: MerkleProof;
        proof_height: Height;
      };
    };
export type SpendConnectionRedeemer =
  | {
      ConnOpenAck: {
        counterparty_client_state: MithrilClientState;
        proof_try: MerkleProof;
        proof_client: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      ConnOpenConfirm: {
        proof_ack: MerkleProof;
        proof_height: Height;
      };
    };
export async function encodeMintConnectionRedeemer(
  mintConnectionRedeemer: MintConnectionRedeemer,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  //merkle proof schema

  const LeafOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerOpSchema = Data.Object({
    hash: Data.Integer(),
    prefix: Data.Bytes(),
    suffix: Data.Bytes(),
  });
  const ExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    value: Data.Bytes(),
    leaf: LeafOpSchema,
    path: Data.Array(InnerOpSchema),
  });
  const NonExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    left: ExistenceProofSchema,
    right: ExistenceProofSchema,
  });

  const CommitmentProof_ProofSchema = Data.Enum([
    Data.Object({
      CommitmentProof_Exist: Data.Object({
        exist: ExistenceProofSchema,
      }),
    }),
    Data.Object({
      CommitmentProof_Nonexist: Data.Object({
        non_exist: NonExistenceProofSchema,
      }),
    }),
    Data.Literal('CommitmentProof_Batch'),
    Data.Literal('CommitmentProof_Compressed'),
  ]);
  const CommitmentProofSchema = Data.Object({
    proof: CommitmentProof_ProofSchema,
  });
  const MerkleProofSchema = Data.Object({
    proofs: Data.Array(CommitmentProofSchema),
  });

  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MithrilHeightSchema = Data.Object({
    mithril_height: Data.Integer(),
  });
  const FractionSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const MithrilProtocolParametersSchema = Data.Object({
    k: Data.Integer(),
    m: Data.Integer(),
    phi_f: Data.Nullable(FractionSchema),
  });
  const MithrilClientStateSchema = Data.Object({
    chain_id: Data.Bytes(),
    latest_height: Data.Nullable(MithrilHeightSchema),
    frozen_height: Data.Nullable(MithrilHeightSchema),
    current_epoch: Data.Integer(),
    trusting_period: Data.Integer(),
    protocol_parameters: Data.Nullable(MithrilProtocolParametersSchema),
    upgrade_path: Data.Array(Data.Bytes()),
  });
  const MintConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenInit: Data.Object({
        handler_auth_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ConnOpenTry: Data.Object({
        handler_auth_token: AuthTokenSchema,
        client_state: MithrilClientStateSchema,
        proof_init: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintConnectionRedeemer = Data.Static<typeof MintConnectionRedeemerSchema>;
  const TMintConnectionRedeemer = MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer;
  return Data.to(mintConnectionRedeemer, TMintConnectionRedeemer);
}
export async function encodeSpendConnectionRedeemer(
  spendConnectionRedeemer: SpendConnectionRedeemer,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MithrilHeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const FractionSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const MithrilProtocolParametersSchema = Data.Object({
    k: Data.Integer(),
    m: Data.Integer(),
    phi_f: Data.Nullable(FractionSchema),
  });
  const MithrilClientStateSchema = Data.Object({
    chain_id: Data.Bytes(),
    latest_height: Data.Nullable(MithrilHeightSchema),
    frozen_height: Data.Nullable(MithrilHeightSchema),
    current_epoch: Data.Integer(),
    trusting_period: Data.Integer(),
    protocol_parameters: Data.Nullable(MithrilProtocolParametersSchema),
    upgrade_path: Data.Array(Data.Bytes()),
  });
  const LeafOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerOpSchema = Data.Object({
    hash: Data.Integer(),
    prefix: Data.Bytes(),
    suffix: Data.Bytes(),
  });
  const ExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    value: Data.Bytes(),
    leaf: LeafOpSchema,
    path: Data.Array(InnerOpSchema),
  });
  const NonExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    left: ExistenceProofSchema,
    right: ExistenceProofSchema,
  });

  const CommitmentProof_ProofSchema = Data.Enum([
    Data.Object({
      CommitmentProof_Exist: Data.Object({
        exist: ExistenceProofSchema,
      }),
    }),
    Data.Object({
      CommitmentProof_Nonexist: Data.Object({
        non_exist: NonExistenceProofSchema,
      }),
    }),
    Data.Literal('CommitmentProof_Batch'),
    Data.Literal('CommitmentProof_Compressed'),
  ]);
  const CommitmentProofSchema = Data.Object({
    proof: CommitmentProof_ProofSchema,
  });
  const MerkleProofSchema = Data.Object({
    proofs: Data.Array(CommitmentProofSchema),
  });

  const SpendConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenAck: Data.Object({
        counterparty_client_state: MithrilClientStateSchema,
        proof_try: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ConnOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TSpendConnectionRedeemer = Data.Static<typeof SpendConnectionRedeemerSchema>;
  const TSpendConnectionRedeemer = SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer;
  return Data.to(spendConnectionRedeemer, TSpendConnectionRedeemer);
}

export function decodeMintConnectionRedeemer(
  mintConnectionRedeemer: string,
  Lucid: typeof import('@dinhbx/lucid-custom'),
): MintConnectionRedeemer {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  //merkle proof schema

  const LeafOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerOpSchema = Data.Object({
    hash: Data.Integer(),
    prefix: Data.Bytes(),
    suffix: Data.Bytes(),
  });
  const ExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    value: Data.Bytes(),
    leaf: LeafOpSchema,
    path: Data.Array(InnerOpSchema),
  });
  const NonExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    left: ExistenceProofSchema,
    right: ExistenceProofSchema,
  });

  const CommitmentProof_ProofSchema = Data.Enum([
    Data.Object({
      CommitmentProof_Exist: Data.Object({
        exist: ExistenceProofSchema,
      }),
    }),
    Data.Object({
      CommitmentProof_Nonexist: Data.Object({
        non_exist: NonExistenceProofSchema,
      }),
    }),
    Data.Literal('CommitmentProof_Batch'),
    Data.Literal('CommitmentProof_Compressed'),
  ]);
  const CommitmentProofSchema = Data.Object({
    proof: CommitmentProof_ProofSchema,
  });
  const MerkleProofSchema = Data.Object({
    proofs: Data.Array(CommitmentProofSchema),
  });

  const MithrilHeightSchema = Data.Object({
    mithril_height: Data.Integer(),
  });
  const FractionSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const MithrilProtocolParametersSchema = Data.Object({
    k: Data.Integer(),
    m: Data.Integer(),
    phi_f: Data.Nullable(FractionSchema),
  });
  const MithrilClientStateSchema = Data.Object({
    chain_id: Data.Bytes(),
    latest_height: Data.Nullable(MithrilHeightSchema),
    frozen_height: Data.Nullable(MithrilHeightSchema),
    current_epoch: Data.Integer(),
    trusting_period: Data.Integer(),
    protocol_parameters: Data.Nullable(MithrilProtocolParametersSchema),
    upgrade_path: Data.Array(Data.Bytes()),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });

  const MintConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenInit: Data.Object({
        handler_auth_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ConnOpenTry: Data.Object({
        handler_auth_token: AuthTokenSchema,
        client_state: MithrilClientStateSchema,
        proof_init: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintConnectionRedeemer = Data.Static<typeof MintConnectionRedeemerSchema>;
  const TMintConnectionRedeemer = MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer;
  return Data.from(mintConnectionRedeemer, TMintConnectionRedeemer);
}
export function decodeSpendConnectionRedeemer(
  spendConnectionRedeemer: string,
  Lucid: typeof import('@dinhbx/lucid-custom'),
): SpendConnectionRedeemer {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MithrilHeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const FractionSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const MithrilProtocolParametersSchema = Data.Object({
    k: Data.Integer(),
    m: Data.Integer(),
    phi_f: Data.Nullable(FractionSchema),
  });
  const MithrilClientStateSchema = Data.Object({
    chain_id: Data.Bytes(),
    latest_height: Data.Nullable(MithrilHeightSchema),
    frozen_height: Data.Nullable(MithrilHeightSchema),
    current_epoch: Data.Integer(),
    trusting_period: Data.Integer(),
    protocol_parameters: Data.Nullable(MithrilProtocolParametersSchema),
    upgrade_path: Data.Array(Data.Bytes()),
  });
  const LeafOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerOpSchema = Data.Object({
    hash: Data.Integer(),
    prefix: Data.Bytes(),
    suffix: Data.Bytes(),
  });
  const ExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    value: Data.Bytes(),
    leaf: LeafOpSchema,
    path: Data.Array(InnerOpSchema),
  });
  const NonExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    left: ExistenceProofSchema,
    right: ExistenceProofSchema,
  });

  const CommitmentProof_ProofSchema = Data.Enum([
    Data.Object({
      CommitmentProof_Exist: Data.Object({
        exist: ExistenceProofSchema,
      }),
    }),
    Data.Object({
      CommitmentProof_Nonexist: Data.Object({
        non_exist: NonExistenceProofSchema,
      }),
    }),
    Data.Literal('CommitmentProof_Batch'),
    Data.Literal('CommitmentProof_Compressed'),
  ]);
  const CommitmentProofSchema = Data.Object({
    proof: CommitmentProof_ProofSchema,
  });
  const MerkleProofSchema = Data.Object({
    proofs: Data.Array(CommitmentProofSchema),
  });

  const SpendConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenAck: Data.Object({
        counterparty_client_state: MithrilClientStateSchema,
        proof_try: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ConnOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TSpendConnectionRedeemer = Data.Static<typeof SpendConnectionRedeemerSchema>;
  const TSpendConnectionRedeemer = SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer;
  return Data.from(spendConnectionRedeemer, TSpendConnectionRedeemer);
}
