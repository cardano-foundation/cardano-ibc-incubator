import { List, ListItem } from '@chakra-ui/react';
import { useState } from 'react';
import { TokenItem } from '../TokenItem/TokenItem';

type NetworkItemProps = {
  tokenId: string;
  tokenName: string;
  tokenLogo: string;
  isActive: boolean;
  onClick: () => void;
};

type TokenListProps = {
  tokenList: Array<NetworkItemProps>;
};

export const TokenList = ({ tokenList }: TokenListProps) => {
  const [tokenSelected, setTokenSelected] = useState<string>();
  const handleClickTokenItem = (tokenId: string) => {
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
