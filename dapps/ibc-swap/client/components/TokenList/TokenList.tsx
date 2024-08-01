import { List, ListItem } from '@chakra-ui/react';
import React, { useState } from 'react';
import { TokenItem } from '../TokenItem/TokenItem';

type TokenItemProps = {
  tokenId: number;
  tokenName?: string;
  tokenLogo?: string;
  isActive?: boolean;
  onClick?: () => void;
};

type TokenListProps = {
  tokenList: Array<TokenItemProps>;
};

export const TokenList: React.FC<TokenListProps> = ({ tokenList }) => {
  const [tokenSelected, setTokenSelected] = useState<number>();
  const handleClickTokenItem = (tokenId: number) => {
    setTokenSelected(tokenId);
  };

  return (
    <List spacing="16px">
      <ListItem padding="16px">
        {tokenList.map((token) => (
          <TokenItem
            key={token.tokenName}
            tokenName={token.tokenName}
            tokenLogo={token.tokenLogo}
            isActive={tokenSelected === token.tokenId}
            onClick={() => handleClickTokenItem(token.tokenId)}
          />
        ))}
      </ListItem>
    </List>
  );
};
