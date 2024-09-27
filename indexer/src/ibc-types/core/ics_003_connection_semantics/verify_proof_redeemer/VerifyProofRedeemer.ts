import {ClientDatumStateSchema} from '../../../client/ics_007_tendermint_client/client_datum/ClientDatumState';
import {ConnectionEndSchema} from '../types/connection_end/ConnectionEnd';
import {MerkleProofSchema} from '../../ics_023_vector_commitments/merkle/MerkleProof';
import {HeightSchema} from '../../../client/ics_007_tendermint_client/height/Height';
import {ChannelSchema} from '../../ics_004/types/channel/Channel';
import {Data} from '../../../plutus/data';

export const VerifyProofRedeemerSchema = Data.Enum([
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
export type VerifyProofRedeemer = Data.Static<typeof VerifyProofRedeemerSchema>;
export const VerifyProofRedeemer = VerifyProofRedeemerSchema as unknown as VerifyProofRedeemer;
