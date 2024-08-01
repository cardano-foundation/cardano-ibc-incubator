import React from 'react';
import { List, ListItem } from '@chakra-ui/react';
import { TokenItem } from '../TokenItem/TokenItem';

export type TokenItemProps = {
  tokenId: number;
  tokenName?: string;
  tokenLogo?: string;
  isActive?: boolean;
  onClick?: () => void;
};

type TokenListProps = {
  tokenList: Array<TokenItemProps>;
  tokenSelected?: TokenItemProps;
  // eslint-disable-next-line no-unused-vars
  onClickToken?: (token: TokenItemProps) => void;
};

export const TokenList: React.FC<TokenListProps> = ({
  tokenSelected,
  tokenList,
  onClickToken,
}) => {
  const handleClickTokenItem = (token: TokenItemProps) => {
    onClickToken?.(token);
  };

  return (
    <List spacing="16px">
      <ListItem padding="16px">
        {tokenList.map((token) => (
          <TokenItem
            key={token.tokenName}
            tokenName={token.tokenName}
            tokenLogo={token.tokenLogo}
            isActive={tokenSelected?.tokenId === token.tokenId}
            onClick={() => handleClickTokenItem(token)}
          />
        ))}
      </ListItem>
    </List>
  );
};
