import { COLOR } from '@/styles/color';
import { Input, InputGroup } from '@chakra-ui/react';
import styled from '@emotion/styled';

const CustomSearchInput = styled(Input)`
  width: 100%;
  gap: 0px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
  color: ${COLOR.neutral_1};
  border: 0px;
  padding: 0px 0px 0px 36px;

  ::placeholder {
    color: ${COLOR.neutral_3};
  }
`;

const CustomSearchInputGroup = styled(InputGroup)`
  width: 100%;
  height: 42px;
  gap: 0px;
  border-radius: 12px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
  box-shadow: 1px 1px 2px 0px #fcfcfc1f inset;
  display: flex;
  align-items: center;
`;

export { CustomSearchInput, CustomSearchInputGroup };
