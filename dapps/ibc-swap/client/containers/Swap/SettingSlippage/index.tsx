/* eslint-disable react/no-unescaped-entities */
import React, { useContext } from 'react';
import {
  background,
  Box,
  Heading,
  Image,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Popover,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '@chakra-ui/react';

import SettingIcon from '@/assets/icons/setting.svg';
import { COLOR } from '@/styles/color';

import SwapContext from '@/contexts/SwapContext';
import StyledSettingSlippage from './index.style';

const SettingSlippage = () => {
  const { swapData, setSwapData } = useContext(SwapContext);

  const handleChangeSlippageTolerance = (value: string) => {
    setSwapData({
      ...swapData,
      slippageTolerance: value,
    });
  };

  return (
    <StyledSettingSlippage>
      <Popover placement="bottom-end">
        <PopoverTrigger>
          <Image src={SettingIcon.src} width="36px" height="36px" alt="" />
        </PopoverTrigger>
        <PopoverContent
          width="232px"
          borderRadius="16px"
          padding="20px"
          border="1px solid #323236"
          bg="#0E0E12"
        >
          <Heading
            fontSize="16px"
            fontWeight={700}
            lineHeight="22px"
            marginBottom="16px"
          >
            Settings
          </Heading>
          <PopoverCloseButton />
          <Box display="flex" marginBottom="10px">
            <Text fontSize="16px" fontWeight={400} lineHeight="22px">
              Slippage tolerance
            </Text>
          </Box>
          <Box display="flex" width="205px" mb="16px">
            <NumberInput
              background="#323236"
              color="white"
              border="none"
              defaultValue={1}
              value={swapData?.slippageTolerance}
              precision={1}
              step={0.1}
              onChange={(value) => handleChangeSlippageTolerance(value)}
            >
              <NumberInputField />
              <NumberInputStepper>
                <NumberIncrementStepper
                  color={COLOR.neutral_1}
                  border="none"
                  _hover={{
                    bgColor: COLOR.neutral_4,
                  }}
                />
                <NumberDecrementStepper
                  color={COLOR.neutral_1}
                  border="none"
                  _hover={{
                    bgColor: COLOR.neutral_4,
                  }}
                />
              </NumberInputStepper>
            </NumberInput>
            <Text className="percent">%</Text>
          </Box>
          <Box display="flex">
            <Text
              fontSize="12px"
              fontWeight={400}
              lineHeight="18px"
              color={COLOR.neutral_3}
            >
              * Slippage tolerance a setting in trading platforms that allows
              you to determine how much price slippage you're willing to accept
              so that your order can be executed.
            </Text>
          </Box>
        </PopoverContent>
      </Popover>
    </StyledSettingSlippage>
  );
};

export default SettingSlippage;
