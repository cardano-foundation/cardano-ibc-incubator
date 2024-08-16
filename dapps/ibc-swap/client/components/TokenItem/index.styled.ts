import { COLOR } from '@/styles/color';
import { Box, BoxProps, Text } from '@chakra-ui/react';
import styled from '@emotion/styled';

interface StyledCustomTokenItemWrapperProps extends BoxProps {
  isActive?: boolean;
  disabled?: boolean;
}

const StyledCustomTokenItemWrapper = styled(
  Box,
)<StyledCustomTokenItemWrapperProps>`
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  height: 48px;
  padding: 9px 12px 9px 12px;
  border-radius: 10px;
  opacity: ${(props) => (props.disabled ? 0.5 : 1)};
  margin: 8px 0px;
  background-color: ${(props) => props.isActive && COLOR.neutral_5};

  :hover {
    background-color: ${(props) => (props.disabled ? 'none' : COLOR.neutral_5)};
  }
`;

const StyledCustomTokenItemName = styled(Text)`
  align-items: center;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  display: block;
`;

export { StyledCustomTokenItemWrapper, StyledCustomTokenItemName };
