import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { SignedHeaderSchema } from "./cometbft/signed_header.ts";
import { ValidatorSetSchema } from "./cometbft/validator_set.ts";
import { HeightSchema } from "./height.ts";

export const HeaderSchema = Data.Object({
  signedHeader: SignedHeaderSchema,
  validatorSet: ValidatorSetSchema,
  trustedHeight: HeightSchema,
  trustedValidators: ValidatorSetSchema,
});
export type Header = Data.Static<typeof HeaderSchema>;
export const Header = HeaderSchema as unknown as Header;
