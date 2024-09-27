import {Data} from '../../plutus/data';

export const CardanoValidatorSchema = Data.Object({
  vrf_key_hash: Data.Bytes(),
  pool_id: Data.Bytes(),
});
export type CardanoValidator = Data.Static<typeof CardanoValidatorSchema>;
export const CardanoValidator = CardanoValidatorSchema as unknown as CardanoValidator;
