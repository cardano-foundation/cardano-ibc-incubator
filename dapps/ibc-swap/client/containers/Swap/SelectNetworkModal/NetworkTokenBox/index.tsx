import React from 'react';
import { Box, Image, Text } from '@chakra-ui/react';

import { COLOR } from '@/styles/color';
import { SearchInput } from '@/components/SearchInput/InputSearch';
import { NetworkList } from '@/components/NetworkList/NetworkList';
import { TokenList } from '@/components/TokenList/TokenList';
import { StyledNetworkBox, StyledNetworkBoxHeader } from './index.style';

import { NetworkListData, TokenListData } from '../data';

const NetworkTokenBox = () => {
  return (
    <StyledNetworkBox>
      <StyledNetworkBoxHeader>
        <Text display="flex" alignItems="center">
          From
        </Text>
        <Box borderRadius="100%" display="flex">
          <Image
            src="https://s2.coinmarketcap.com/static/img/coins/200x200/4263.png"
            alt="ADA"
            width="32px"
            height="32px"
          />
          <Box ml="10px" display="flex" alignItems="center">
            <Box>
              <Text fontWeight="700" fontSize="18px">
                ADA
              </Text>
              <Text fontSize="12px">Cardano</Text>
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
            <NetworkList networkList={NetworkListData} />
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
            <TokenList tokenList={TokenListData} />
          </Box>
        </Box>
      </Box>
    </StyledNetworkBox>
  );
};

export default NetworkTokenBox;
