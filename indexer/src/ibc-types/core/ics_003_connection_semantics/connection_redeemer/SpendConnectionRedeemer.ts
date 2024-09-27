import {MerkleProofSchema} from '../../ics_023_vector_commitments/merkle/MerkleProof';
import {HeightSchema} from '../../../client/ics_007_tendermint_client/height/Height';
import {MithrilClientStateSchema} from '../../../client/mithril_pb/MithrilClientState';
import {Data} from '../../../plutus/data';
import {CardanoClientStateSchema} from '../../../client/cardano_pb/CardanoClientState';

export const SpendConnectionRedeemerSchema = Data.Enum([
  Data.Object({
    ConnOpenAck: Data.Object({
      counterparty_client_state: CardanoClientStateSchema,
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
export type SpendConnectionRedeemer = Data.Static<typeof SpendConnectionRedeemerSchema>;
export const SpendConnectionRedeemer = SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer;
