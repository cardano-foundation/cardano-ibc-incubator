import { AuthToken } from '../auth-token';
import { Data } from '@lucid-evolution/lucid';
import { Height } from '../height';
import { Packet } from './packet';
import { MerkleProof } from '../isc-23/merkle';

export type MintChannelRedeemer =
  | {
      ChanOpenInit: {
        handler_token: AuthToken;
      };
    }
  | {
      ChanOpenTry: {
        handler_token: AuthToken;
        counterparty_version: string;
        proof_init: MerkleProof;
        proof_height: Height;
      };
    };

export type SpendChannelRedeemer =
  | {
      ChanOpenAck: {
        counterparty_version: string;
        proof_try: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      ChanOpenConfirm: {
        proof_ack: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      RecvPacket: {
        packet: Packet;
        proof_commitment: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      TimeoutPacket: {
        packet: Packet;
        proof_unreceived: MerkleProof;
        proof_height: Height;
        next_sequence_recv: bigint;
      };
    }
  | {
      AcknowledgePacket: {
        packet: Packet;
        acknowledgement: string;
        proof_acked: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      SendPacket: {
        packet: Packet;
      };
    }
  | 'ChanCloseInit'
  | {
      ChanCloseConfirm: {
        proof_init: MerkleProof;
        proof_height: Height;
      };
    }
  | 'RefreshUtxo';
export async function encodeMintChannelRedeemer(
  mintChannelRedeemer: MintChannelRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
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

  const MintChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenInit: Data.Object({
        handler_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ChanOpenTry: Data.Object({
        handler_token: AuthTokenSchema,
        counterparty_version: Data.Bytes(),
        proof_init: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintChannelRedeemer = Data.Static<typeof MintChannelRedeemerSchema>;
  const TMintChannelRedeemer = MintChannelRedeemerSchema as unknown as MintChannelRedeemer;
  return Data.to(mintChannelRedeemer, TMintChannelRedeemer, { canonical: true });
}

export async function encodeSpendChannelRedeemer(
  spendChannelRedeemer: SpendChannelRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
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

  const PacketSchema = Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
  const SpendChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenAck: Data.Object({
        counterparty_version: Data.Bytes(),
        proof_try: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ChanOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      RecvPacket: Data.Object({
        packet: PacketSchema,
        proof_commitment: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      TimeoutPacket: Data.Object({
        packet: PacketSchema,
        proof_unreceived: MerkleProofSchema,
        proof_height: HeightSchema,
        next_sequence_recv: Data.Integer(),
      }),
    }),
    Data.Object({
      AcknowledgePacket: Data.Object({
        packet: PacketSchema,
        acknowledgement: Data.Bytes(),
        proof_acked: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      SendPacket: Data.Object({
        packet: PacketSchema,
      }),
    }),
    Data.Literal('ChanCloseInit'),
    Data.Object({
      ChanCloseConfirm: Data.Object({
        proof_init: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Literal('RefreshUtxo'),
  ]);
  type TSpendChannelRedeemer = Data.Static<typeof SpendChannelRedeemerSchema>;
  const TSpendChannelRedeemer = SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer;
  return Data.to(spendChannelRedeemer, TSpendChannelRedeemer, { canonical: true });
}

export function decodeMintChannelRedeemer(
  mintChannelRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): MintChannelRedeemer {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
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

  const MintChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenInit: Data.Object({
        handler_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ChanOpenTry: Data.Object({
        handler_token: AuthTokenSchema,
        counterparty_version: Data.Bytes(),
        proof_init: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintChannelRedeemer = Data.Static<typeof MintChannelRedeemerSchema>;
  const TMintChannelRedeemer = MintChannelRedeemerSchema as unknown as MintChannelRedeemer;
  return Data.from(mintChannelRedeemer, TMintChannelRedeemer);
}

export function decodeSpendChannelRedeemer(
  spendChannelRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): SpendChannelRedeemer {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
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

  const PacketSchema = Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
  const SpendChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenAck: Data.Object({
        counterparty_version: Data.Bytes(),
        proof_try: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ChanOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      RecvPacket: Data.Object({
        packet: PacketSchema,
        proof_commitment: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      TimeoutPacket: Data.Object({
        packet: PacketSchema,
        proof_unreceived: MerkleProofSchema,
        proof_height: HeightSchema,
        next_sequence_recv: Data.Integer(),
      }),
    }),
    Data.Object({
      AcknowledgePacket: Data.Object({
        packet: PacketSchema,
        acknowledgement: Data.Bytes(),
        proof_acked: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      SendPacket: Data.Object({
        packet: PacketSchema,
      }),
    }),
    Data.Literal('ChanCloseInit'),
    Data.Object({
      ChanCloseConfirm: Data.Object({
        proof_init: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Literal('RefreshUtxo'),
  ]);
  type TSpendChannelRedeemer = Data.Static<typeof SpendChannelRedeemerSchema>;
  const TSpendChannelRedeemer = SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer;
  return Data.from(spendChannelRedeemer, TSpendChannelRedeemer);
}
