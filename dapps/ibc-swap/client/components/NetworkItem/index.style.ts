import { COLOR } from '@/styles/color';
import { Box, BoxProps, Text } from '@chakra-ui/react';
import styled from '@emotion/styled';

interface StyledNetworkItemWrapperProps extends BoxProps {
  isActive?: boolean;
}

const StyledNetworkItemWrapper = styled(Box)<StyledNetworkItemWrapperProps>`
  display: flex;
  gap: 16px;
  align-content: center;
  padding: 16px;
  cursor: pointer;
  min-height: 48px;
  align-items: center;
  padding: 9px 12px 9px 12px;
  border-radius: 10px;
  opacity: 0px;
  margin: 8px 0px;
  background-color: ${(props) => props.isActive && COLOR.neutral_5};
  :hover {
    background-color: ${COLOR.neutral_5};
  }
`;

const StyledNetworkItemName = styled(Text)`
  align-content: center;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  display: block;
  max-width: 50%;
  max-height: 50px;
  break-word: break-word;
`;

export { StyledNetworkItemName, StyledNetworkItemWrapper };
