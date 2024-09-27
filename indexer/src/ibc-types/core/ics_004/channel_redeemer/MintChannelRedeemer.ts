import {AuthTokenSchema} from '../../../auth/AuthToken';
import {MerkleProofSchema} from '../../ics_023_vector_commitments/merkle/MerkleProof';
import {HeightSchema} from '../../../client/ics_007_tendermint_client/height/Height';
import {Data} from '../../../plutus/data';

export const MintChannelRedeemerSchema = Data.Enum([
  Data.Object({
    ChanOpenInit: Data.Object({handler_token: AuthTokenSchema}),
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
export type MintChannelRedeemer = Data.Static<typeof MintChannelRedeemerSchema>;
export const MintChannelRedeemer = MintChannelRedeemerSchema as unknown as MintChannelRedeemer;
