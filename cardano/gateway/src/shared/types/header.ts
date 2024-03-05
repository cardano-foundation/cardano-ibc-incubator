import { ValidatorSet } from './cometbft/validator-set';
import { SignedHeader } from './cometbft/signed-header';
import { Height } from './height';

export type Header = {
  signedHeader: SignedHeader;
  validatorSet: ValidatorSet;
  trustedHeight: Height;
  trustedValidators: ValidatorSet;
};
