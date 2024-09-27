import {Data} from '../../../plutus/data';
import {SignedHeaderSchema} from '../cometbft/signed_header/SignedHeader';
import {ValidatorSetSchema} from '../cometbft/validator_set/ValidatorSet';
import {HeightSchema} from '../height/Height';

export const HeaderSchema = Data.Object({
  signed_header: SignedHeaderSchema,
  validator_set: ValidatorSetSchema,
  trusted_height: HeightSchema,
  trusted_validators: ValidatorSetSchema,
});
export type Header = Data.Static<typeof HeaderSchema>;
export const Header = HeaderSchema as unknown as Header;
