import { COLOR } from '@/styles/color';
import { Box, Text } from '@chakra-ui/react';
import styled from '@emotion/styled';

const CustomNetworkItemWrapper = styled(Box)`
  display: flex;
  gap: 16px;
  align-content: center;
  padding: 16px;
  cursor: pointer;
  height: 48px;
  padding: 9px 12px 9px 12px;
  border-radius: 10px;
  opacity: 0px;

  :hover {
    background-color: ${COLOR.neutral_5};
  }
`;

const CustomNetworkItemName = styled(Text)`
  align-content: center;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  display: block;
`;

export { CustomNetworkItemWrapper, CustomNetworkItemName };
