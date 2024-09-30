import { COLOR } from '@/styles/color';
import { Box, BoxProps, Text } from '@chakra-ui/react';
import styled from '@emotion/styled';

interface StyledNetworkItemWrapperProps extends BoxProps {
  isActive?: boolean;
  isDisabled?: boolean;
}

const StyledNetworkItemWrapper = styled(Box)<StyledNetworkItemWrapperProps>`
  display: flex;
  gap: 16px;
  align-content: center;
  padding: 16px;
  cursor: ${(props) => (props.isDisabled ? 'not-allowed' : 'pointer')};
  min-height: 48px;
  align-items: center;
  padding: 9px 12px 9px 12px;
  border-radius: 10px;
  opacity: ${(props) => (props.isDisabled ? 0.5 : 1)};
  margin: 8px 0px;
  background-color: ${(props) =>
    props.isActive ? COLOR.neutral_5 : undefined};
  :hover {
    background-color: ${(props) =>
      !props.isDisabled ? COLOR.neutral_5 : undefined};
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
