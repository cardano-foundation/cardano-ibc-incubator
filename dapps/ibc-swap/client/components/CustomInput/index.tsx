import React from 'react';
import { Input, Text } from '@chakra-ui/react';

import { COLOR } from '@/styles/color';

import { StyledGroupInput } from './index.style';

type CustomInputProps = {
  title: string;
  placeholder: string;
};

const CustomInput = ({ title, placeholder }: CustomInputProps) => {
  return (
    <StyledGroupInput>
      <Text
        color={COLOR.neutral_3}
        fontSize={12}
        fontWeight={400}
        lineHeight="18px"
      >
        {title}
      </Text>
      <Input
        variant="unstyled"
        placeholder={placeholder}
        color={COLOR.neutral_1}
        fontSize={16}
        fontWeight={400}
        lineHeight="22px"
        _placeholder={{
          color: COLOR.neutral_2,
        }}
      />
    </StyledGroupInput>
  );
};

export default CustomInput;
