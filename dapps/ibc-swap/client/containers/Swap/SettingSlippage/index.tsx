import React from 'react';
import {
  Box,
  Heading,
  Image,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '@chakra-ui/react';

import SettingIcon from '@/assets/icons/setting.svg';
import InfoIcon from '@/assets/icons/info.svg';

import StyledSettingSlippage from './index.style';

const SettingSlippage = () => {
  return (
    <StyledSettingSlippage>
      <Popover placement="bottom">
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
          <Heading fontSize="16px" marginBottom="15px">
            Settings
          </Heading>
          <Box display="flex" marginBottom="10px">
            <Text paddingRight="5px">Slippage tolerance</Text>
            <Image src={InfoIcon.src} alt="" />
          </Box>
          <Box display="flex" width="205px">
            <NumberInput
              background="#323236"
              color="white"
              border="none"
              defaultValue={1}
              precision={1}
              step={0.1}
            >
              <NumberInputField />
              <NumberInputStepper>
                <NumberIncrementStepper />
                <NumberDecrementStepper />
              </NumberInputStepper>
            </NumberInput>
            <Text className="percent">%</Text>
          </Box>
        </PopoverContent>
      </Popover>
    </StyledSettingSlippage>
  );
};

export default SettingSlippage;
