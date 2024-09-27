import {UncheckedRationalSchema} from '../types/unchecked_rational/UncheckedRational';
import {HeightSchema} from '../height/Height';
import {ProofSpecSchema} from '../../../core/ics_023_vector_commitments/ics23/proofs/ProofSpec';
import {Data} from '../../../plutus/data';

export const ClientStateSchema = Data.Object({
  chain_id: Data.Bytes(),
  trust_level: UncheckedRationalSchema,
  trusting_period: Data.Integer(),
  unbonding_period: Data.Integer(),
  max_clock_drift: Data.Integer(),
  frozen_height: HeightSchema,
  latest_height: HeightSchema,
  proof_specs: Data.Array(ProofSpecSchema),
});
export type ClientState = Data.Static<typeof ClientStateSchema>;
export const ClientState = ClientStateSchema as unknown as ClientState;
