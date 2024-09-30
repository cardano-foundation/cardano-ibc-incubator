// TODO: define TokenType when have data
export type TokenType = {
  tokenDenom: string;
  tokenLogo: string;
  tokenId: string;
};

// TODO: define ChainType when have data
export type ChainType = {
  chainName: string;
  chainLogo: string;
  chainId: string;
};

// TODO: define TransactionType when have data
export type TransactionType = {
  token: TokenType;
  fromTxHash: string;
  fromAddress: string;
  toAddress: string;
  toNetworkLogo: string;
  fromChainId: string;
  status: string;
  toTxHash?: string;
  createTime: string;
  endTime?: string;
  amount: string;
};

export type StatusType = {
  label: string;
  value: string;
};
