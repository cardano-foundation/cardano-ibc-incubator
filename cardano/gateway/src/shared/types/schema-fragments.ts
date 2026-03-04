type LucidData = typeof import('@lucid-evolution/lucid').Data;

export function createAuthTokenSchema(Data: LucidData) {
  return Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
}

export function createHeightSchema(Data: LucidData) {
  return Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
}

export function createIcs23LeafOpSchema(Data: LucidData) {
  return Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
}

export function createIcs23MerkleProofSchema(Data: LucidData) {
  const LeafOpSchema = createIcs23LeafOpSchema(Data);
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

  return {
    LeafOpSchema,
    InnerOpSchema,
    ExistenceProofSchema,
    NonExistenceProofSchema,
    CommitmentProof_ProofSchema,
    CommitmentProofSchema,
    MerkleProofSchema,
  };
}

export function createProofSpecSchema(Data: LucidData) {
  const LeafOpSchema = createIcs23LeafOpSchema(Data);
  const InnerSpecSchema = Data.Object({
    child_order: Data.Array(Data.Integer()),
    child_size: Data.Integer(),
    min_prefix_length: Data.Integer(),
    max_prefix_length: Data.Integer(),
    empty_child: Data.Bytes(),
    hash: Data.Integer(),
  });
  const ProofSpecSchema = Data.Object({
    leaf_spec: LeafOpSchema,
    inner_spec: InnerSpecSchema,
    max_depth: Data.Integer(),
    min_depth: Data.Integer(),
    prehash_key_before_comparison: Data.Boolean(),
  });

  return {
    LeafOpSchema,
    InnerSpecSchema,
    ProofSpecSchema,
  };
}

export function createMithrilClientStateSchema(Data: LucidData) {
  const MithrilHeightSchema = createHeightSchema(Data);
  const FractionSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const MithrilProtocolParametersSchema = Data.Object({
    k: Data.Integer(),
    m: Data.Integer(),
    phi_f: FractionSchema,
  });

  return Data.Object({
    chain_id: Data.Bytes(),
    latest_height: MithrilHeightSchema,
    frozen_height: MithrilHeightSchema,
    current_epoch: Data.Integer(),
    trusting_period: Data.Integer(),
    protocol_parameters: MithrilProtocolParametersSchema,
    upgrade_path: Data.Array(Data.Bytes()),
    host_state_nft_policy_id: Data.Bytes(),
    host_state_nft_token_name: Data.Bytes(),
  });
}

export function createTendermintClientStateSchema(Data: LucidData) {
  const RationalSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const HeightSchema = createHeightSchema(Data);
  const { ProofSpecSchema } = createProofSpecSchema(Data);

  return Data.Object({
    chainId: Data.Bytes(),
    trustLevel: RationalSchema,
    trustingPeriod: Data.Integer(),
    unbondingPeriod: Data.Integer(),
    maxClockDrift: Data.Integer(),
    frozenHeight: HeightSchema,
    latestHeight: HeightSchema,
    proofSpecs: Data.Array(ProofSpecSchema),
  });
}

export function createConsensusStateSchema(Data: LucidData) {
  const MerkleRootSchema = Data.Object({
    hash: Data.Bytes(),
  });

  return Data.Object({
    timestamp: Data.Integer(),
    next_validators_hash: Data.Bytes(),
    root: MerkleRootSchema,
  });
}

export function createMerklePathSchema(Data: LucidData) {
  return Data.Object({
    key_path: Data.Array(Data.Bytes()),
  });
}

export function createPacketSchema(Data: LucidData, HeightSchema = createHeightSchema(Data)) {
  return Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
}
