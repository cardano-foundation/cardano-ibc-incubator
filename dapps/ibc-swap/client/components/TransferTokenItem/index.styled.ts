import { COLOR } from '@/styles/color';
import { Box, Text } from '@chakra-ui/react';
import styled from '@emotion/styled';

const CustomTokenItemWrapper = styled(Box)`
  display: flex;
  gap: 16px;
  align-content: center;
  justify-content: space-between;
  padding: 16px;
  cursor: pointer;
  height: 56px;
  padding: 8px 12px 8px 12px;
  border-radius: 10px;
  opacity: 0px;
  margin-top: 8px;
  margin-bottom: 16px;

  :hover {
    background-color: ${COLOR.neutral_5};
  }
`;

const CustomTokenItemName = styled(Text)`
  align-content: center;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  display: block;
`;

export { CustomTokenItemWrapper, CustomTokenItemName };
