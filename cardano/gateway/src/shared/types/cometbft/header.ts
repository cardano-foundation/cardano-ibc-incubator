export type TmHeader = {
  chainId: string;
  height: bigint;
  time: bigint;
  validatorsHash: string;
  nextValidatorsHash: string;
  appHash: string;
};
