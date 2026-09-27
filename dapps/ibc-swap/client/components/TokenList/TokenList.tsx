import React from 'react';
import { List, ListItem } from '@chakra-ui/react';
import type { TokenPresentation } from '@/types/token';
import { TokenItem } from '../TokenItem/TokenItem';

export type TokenItemProps = TokenPresentation & {
  tokenId: string;
  isActive?: boolean;
  onClick?: () => void;
};

type TokenListProps = {
  tokenList: Array<TokenItemProps>;
  tokenSelected?: TokenItemProps;
  // eslint-disable-next-line no-unused-vars
  onClickToken?: (token: TokenItemProps) => void;
  disabledToken?: TokenItemProps;
};

export const TokenList: React.FC<TokenListProps> = ({
  tokenSelected,
  tokenList,
  onClickToken,
  disabledToken,
}) => {
  const handleClickTokenItem = (token: TokenItemProps) => {
    onClickToken?.(token);
  };

  return (
    <List spacing="16px">
      <ListItem padding="16px">
        {tokenList.map((token) => (
          <TokenItem
            key={token.tokenId}
            {...token}
            isActive={tokenSelected?.tokenId === token.tokenId}
            onClick={
              disabledToken?.tokenId === token.tokenId
                ? () => {}
                : () => handleClickTokenItem(token)
            }
            disabled={disabledToken?.tokenId === token.tokenId}
          />
        ))}
      </ListItem>
    </List>
  );
};
