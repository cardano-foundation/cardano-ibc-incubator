import React from 'react';
import { Box, Text, Image } from '@chakra-ui/react';

import InfoIcon from '@/assets/icons/info.svg';

import StyledTransactionFee from './index.style';

const TransactionFee = () => {
  return (
    <StyledTransactionFee>
      <Box display="flex" justifyContent="space-between">
        <Box display="flex" gap="5px">
          <Image src={InfoIcon.src} alt="" />
          <Text className="label">Minimum receive</Text>
        </Box>
        <Text>4.4829482 ADA</Text>
      </Box>
      <Box display="flex" gap="5px" mt="5px" justifyContent="space-between">
        <Box display="flex" gap="5px">
          <Image src={InfoIcon.src} alt="" />
          <Text className="label">Tx Fee</Text>
        </Box>
        <Text>1.924 ADA</Text>
      </Box>
    </StyledTransactionFee>
  );
};

export default TransactionFee;
