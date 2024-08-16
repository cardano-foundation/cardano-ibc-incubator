import styled from '@emotion/styled';
import { COLOR } from '@/styles/color';
import { BoxProps } from '@chakra-ui/react';

interface StyledInputGroupProps extends BoxProps {
  isError?: boolean;
}

const StyledGroupInput = styled.div<StyledInputGroupProps>`
  display: inline-grid;
  width: 100%;
  margin-top: 16px;
  background: ${COLOR.neutral_5};
  height: 64px;
  padding: 9px 16px 11px 16px;
  gap: 4px;
  border-radius: 10px;
  opacity: 0px;
  border: ${(props) => props.isError && `1px solid ${COLOR.error}`};
`;

export { StyledGroupInput };
