import { Data } from '@dinhbx/lucid-custom';
import { Channel } from '../channel/channel';
import { ClientDatumState } from '../client-datum-state';
import { Height } from '../height';
import { MerkleProof } from '../isc-23/merkle';
import { ConnectionEnd } from './connection-end';

export type VerifyProofRedeemer =
  | {
      VerifyChannelState: {
        client_datum_state: ClientDatumState;
        connection: ConnectionEnd;
        port_id: string;
        channel_id: string;
        proof: MerkleProof;
        proof_height: Height;
        channel: Channel;
      };
    }
  | {
      VerifyPacketCommitment: {
        client_datum_state: ClientDatumState;
        connection: ConnectionEnd;
        proof_height: Height;
        proof: MerkleProof;
        port_id: string;
        channel_id: string;
        sequence: bigint;
        commitment_bytes: string;
      };
    }
  | {
      VerifyPacketAcknowledgement: {
        client_datum_state: ClientDatumState;
        connection: ConnectionEnd;
        proof_height: Height;
        proof: MerkleProof;
        port_id: string;
        channel_id: string;
        sequence: bigint;
        acknowledgement: string;
      };
    }
  | {
      VerifyPacketReceiptAbsence: {
        client_datum_state: ClientDatumState;
        connection: ConnectionEnd;
        proof_height: Height;
        proof: MerkleProof;
        port_id: string;
        channel_id: string;
        sequence: bigint;
      };
    }
  | 'VerifyOther';

export function encodeVerifyProofRedeemer(
  verifyProofRedeemer: VerifyProofRedeemer,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;

  const RationalSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const LeaftOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerSpecSchema = Data.Object({
    child_order: Data.Array(Data.Integer()),
    child_size: Data.Integer(),
    min_prefix_length: Data.Integer(),
    max_prefix_length: Data.Integer(),
    empty_child: Data.Bytes(),
    hash: Data.Integer(),
  });
  const ProofSpecSchema = Data.Object({
    leaf_spec: LeaftOpSchema,
    inner_spec: InnerSpecSchema,
    max_depth: Data.Integer(),
    min_depth: Data.Integer(),
    prehash_key_before_comparison: Data.Boolean(),
  });
  const ClientStateSchema = Data.Object({
    chainId: Data.Bytes(),
    trustLevel: RationalSchema,
    trustingPeriod: Data.Integer(),
    unbondingPeriod: Data.Integer(),
    maxClockDrift: Data.Integer(),
    frozenHeight: HeightSchema,
    latestHeight: HeightSchema,
    proofSpecs: Data.Array(ProofSpecSchema),
  });

  const MerkleRootSchema = Data.Object({
    hash: Data.Bytes(),
  });
  const ConsensusStateSchema = Data.Object({
    timestamp: Data.Integer(),
    next_validators_hash: Data.Bytes(),
    root: MerkleRootSchema,
  });
  const ClientDatumStateSchema = Data.Object({
    clientState: ClientStateSchema,
    consensusStates: Data.Map(HeightSchema, ConsensusStateSchema),
  });

  const VersionSchema = Data.Object({
    identifier: Data.Bytes(),
    features: Data.Array(Data.Bytes()),
  });
  const ConnectionStateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
  ]);
  const MerklePrefixSchema = Data.Object({
    key_prefix: Data.Bytes(),
  });
  const CounterpartySchema = Data.Object({
    // identifies the client on the counterparty chain associated with a given connection.
    client_id: Data.Bytes(),
    // identifies the connection end on the counterparty chain associated with a given connection.
    connection_id: Data.Bytes(),
    // commitment merkle prefix of the counterparty chain.
    prefix: MerklePrefixSchema,
  });
  const ConnectionEndSchema = Data.Object({
    client_id: Data.Bytes(),
    versions: Data.Array(VersionSchema),
    state: ConnectionStateSchema,
    counterparty: CounterpartySchema,
    delay_period: Data.Integer(),
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

  const ChannelStateSchema = Data.Enum([
    Data.Literal('Uninitialized'),
    Data.Literal('Init'),
    Data.Literal('TryOpen'),
    Data.Literal('Open'),
    Data.Literal('Close'),
  ]);
  const OrderSchema = Data.Enum([Data.Literal('None'), Data.Literal('Unordered'), Data.Literal('Ordered')]);
  const ChannelCounterpartySchema = Data.Object({
    port_id: Data.Bytes(),
    channel_id: Data.Bytes(),
  });
  const ChannelSchema = Data.Object({
    state: ChannelStateSchema,
    ordering: OrderSchema,
    counterparty: ChannelCounterpartySchema,
    connection_hops: Data.Array(Data.Bytes()),
    version: Data.Bytes(),
  });

  const VerifyProofRedeemerSchema = Data.Enum([
    Data.Object({
      VerifyChannelState: Data.Object({
        client_datum_state: ClientDatumStateSchema,
        connection: ConnectionEndSchema,
        port_id: Data.Bytes(),
        channel_id: Data.Bytes(),
        proof: MerkleProofSchema,
        proof_height: HeightSchema,
        channel: ChannelSchema,
      }),
    }),
    Data.Object({
      VerifyPacketCommitment: Data.Object({
        client_datum_state: ClientDatumStateSchema,
        connection: ConnectionEndSchema,
        proof_height: HeightSchema,
        proof: MerkleProofSchema,
        port_id: Data.Bytes(),
        channel_id: Data.Bytes(),
        sequence: Data.Integer(),
        commitment_bytes: Data.Bytes(),
      }),
    }),
    Data.Object({
      VerifyPacketAcknowledgement: Data.Object({
        client_datum_state: ClientDatumStateSchema,
        connection: ConnectionEndSchema,
        proof_height: HeightSchema,
        proof: MerkleProofSchema,
        port_id: Data.Bytes(),
        channel_id: Data.Bytes(),
        sequence: Data.Integer(),
        acknowledgement: Data.Bytes(),
      }),
    }),
    Data.Object({
      VerifyPacketReceiptAbsence: Data.Object({
        client_datum_state: ClientDatumStateSchema,
        connection: ConnectionEndSchema,
        proof_height: HeightSchema,
        proof: MerkleProofSchema,
        port_id: Data.Bytes(),
        channel_id: Data.Bytes(),
        sequence: Data.Integer(),
      }),
    }),
    Data.Literal('VerifyOther'),
  ]);
  type TVerifyProofRedeemer = Data.Static<typeof VerifyProofRedeemerSchema>;
  const TVerifyProofRedeemer = VerifyProofRedeemerSchema as unknown as VerifyProofRedeemer;
  return Data.to(verifyProofRedeemer, TVerifyProofRedeemer);
}
