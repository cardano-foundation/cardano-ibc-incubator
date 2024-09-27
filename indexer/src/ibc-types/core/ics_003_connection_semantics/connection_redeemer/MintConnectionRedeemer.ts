import {AuthTokenSchema} from '../../../auth/AuthToken';
import {MerkleProofSchema} from '../../ics_023_vector_commitments/merkle/MerkleProof';
import {HeightSchema} from '../../../client/ics_007_tendermint_client/height/Height';
import {CardanoClientStateSchema} from '../../../client/cardano_pb/CardanoClientState';
import {Data} from '../../../plutus/data';

export const MintConnectionRedeemerSchema = Data.Enum([
  Data.Object({
    ConnOpenInit: Data.Object({handler_auth_token: AuthTokenSchema}),
  }),
  Data.Object({
    ConnOpenTry: Data.Object({
      handler_auth_token: AuthTokenSchema,
      client_state: CardanoClientStateSchema,
      proof_init: MerkleProofSchema,
      proof_client: MerkleProofSchema,
      proof_height: HeightSchema,
    }),
  }),
]);
export type MintConnectionRedeemer = Data.Static<typeof MintConnectionRedeemerSchema>;
export const MintConnectionRedeemer = MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer;
