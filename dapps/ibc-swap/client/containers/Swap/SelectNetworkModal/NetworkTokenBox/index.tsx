/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from 'react';
import { Box, Image, Text } from '@chakra-ui/react';

import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import { NetworkList } from '@/components/NetworkList/NetworkList';
import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import { TokenItemProps, TokenList } from '@/components/TokenList/TokenList';
import EarchIcon from '@/assets/icons/earth.svg';
import { FROM_TO } from '@/constants';
import { StyledNetworkBox, StyledNetworkBoxHeader } from './index.style';

import { NetworkListData, TokenListData } from '../data';

export interface TokenSelectedProps {
  token?: TokenItemProps;
  network?: NetworkItemProps;
}

export interface TokenNetworkSelectedProps {
  tokenFrom?: TokenSelectedProps;
  tokenTo?: TokenSelectedProps;
}

type NetworkTokenBoxProps = {
  fromOrTo?: string;
  onChooseToken?: ({
    token,
    network,
  }: {
    token?: TokenItemProps;
    network?: NetworkItemProps;
  }) => void;
  selectedToken?: TokenNetworkSelectedProps;
};

const NetworkTokenBox = ({
  fromOrTo = FROM_TO.FROM,
  onChooseToken,
  selectedToken,
}: NetworkTokenBoxProps) => {
  const [tokenSelected, setTokenSelected] = useState<TokenItemProps>();
  const [networkSelected, setNetworkSelected] = useState<NetworkItemProps>();

  const handleClickTokenItem = (token: TokenItemProps) => {
    if (!networkSelected) return;
    setTokenSelected(token);
    onChooseToken?.({ token, network: networkSelected });
  };

  const handleClickNetworkItem = (network: NetworkItemProps) => {
    setNetworkSelected(network);
    setTokenSelected(undefined);
  };

  useEffect(() => {
    if (fromOrTo === FROM_TO.TO) {
      setTokenSelected(selectedToken?.tokenTo?.token);
      setNetworkSelected(selectedToken?.tokenTo?.network);
    } else {
      setTokenSelected(selectedToken?.tokenFrom?.token);
      setNetworkSelected(selectedToken?.tokenFrom?.network);
    }
  }, [selectedToken, fromOrTo]);

  return (
    <StyledNetworkBox isChoseToken={!!tokenSelected?.tokenId}>
      <StyledNetworkBoxHeader isChoseToken={!!tokenSelected?.tokenId}>
        <Text display="flex" alignItems="center">
          {fromOrTo}
        </Text>
        <Box borderRadius="100%" display="flex">
          <Image
            src={tokenSelected?.tokenLogo || EarchIcon.src}
            alt={tokenSelected?.tokenName || ''}
            width="32px"
            height="32px"
          />
          <Box ml="10px" display="flex" alignItems="center">
            <Box>
              <Text fontWeight="700" fontSize="18px">
                {tokenSelected?.tokenName}
              </Text>
              <Text fontSize="12px">
                {networkSelected?.networkId ? (
                  networkSelected?.networkName
                ) : (
                  <Text fontSize="18px">Select Network</Text>
                )}
              </Text>
            </Box>
          </Box>
        </Box>
      </StyledNetworkBoxHeader>
      <Box display="flex">
        <Box>
          <Box
            p="16px"
            borderBottomWidth="1px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <SearchInput placeholder="Search network" />
          </Box>
          <Box
            maxH="368px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
            overflowY="scroll"
          >
            <NetworkList
              networkList={NetworkListData}
              networkSelected={networkSelected}
              onClickNetwork={handleClickNetworkItem}
            />
          </Box>
        </Box>
        <Box>
          <Box
            p="16px"
            borderBottomWidth="1px"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <SearchInput placeholder="Search token" />
          </Box>
          <Box
            maxH="368px"
            overflowY="scroll"
            borderRightWidth="1px"
            borderColor={COLOR.neutral_5}
          >
            <TokenList
              tokenList={TokenListData}
              tokenSelected={tokenSelected}
              onClickToken={handleClickTokenItem}
            />
          </Box>
        </Box>
      </Box>
    </StyledNetworkBox>
  );
};

export default NetworkTokenBox;
