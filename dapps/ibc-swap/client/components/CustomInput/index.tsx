import React, { ChangeEvent, useState } from 'react';
import { Input, Text } from '@chakra-ui/react';

import { COLOR } from '@/styles/color';

import { StyledGroupInput } from './index.style';

type CustomInputProps = {
  title: string;
  placeholder: string;
  // eslint-disable-next-line no-unused-vars
  onChange?: (value: string) => void;
  errorMsg?: string;
  disabled?: boolean;
};

const CustomInput = ({
  title,
  placeholder,
  onChange,
  errorMsg,
  disabled,
}: CustomInputProps) => {
  const [value, setValue] = useState<string>('');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    onChange?.(event.target.value);
  };

  return (
    <>
      <StyledGroupInput isError={!!errorMsg}>
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
          value={value}
          onChange={handleChange}
          _placeholder={{
            color: COLOR.neutral_2,
          }}
          disabled={disabled}
        />
      </StyledGroupInput>
      {errorMsg && (
        <Text
          fontSize={14}
          fontWeight={400}
          lineHeight="20px"
          color={COLOR.error}
        >
          {errorMsg}
        </Text>
      )}
    </>
  );
};

export default CustomInput;
