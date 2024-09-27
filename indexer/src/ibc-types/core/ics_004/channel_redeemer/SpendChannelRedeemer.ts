import {MerkleProofSchema} from '../../ics_023_vector_commitments/merkle/MerkleProof';
import {HeightSchema} from '../../../client/ics_007_tendermint_client/height/Height';
import {PacketSchema} from '../types/packet/Packet';
import {Data} from '../../../plutus/data';

export const SpendChannelRedeemerSchema = Data.Enum([
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
  Data.Object({SendPacket: Data.Object({packet: PacketSchema})}),
  Data.Literal('RefreshUtxo'),
]);
export type SpendChannelRedeemer = Data.Static<typeof SpendChannelRedeemerSchema>;
export const SpendChannelRedeemer = SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer;
