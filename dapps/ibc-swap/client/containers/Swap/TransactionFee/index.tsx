import React from 'react';
import { Box, Text, Image } from '@chakra-ui/react';

import InfoIcon from '@/assets/icons/info.svg';

import StyledTransactionFee from './index.style';

const TransactionFee = ({
  minimumReceived,
  estFee,
}: {
  minimumReceived: string;
  estFee: string;
}) => {
  // TODO: Estimate transaction fee
  return (
    <StyledTransactionFee>
      <Box display="flex" justifyContent="space-between">
        <Box display="flex" gap="5px">
          <Image src={InfoIcon.src} alt="" />
          <Text className="label">Minimum receive</Text>
        </Box>
        <Text>{minimumReceived}</Text>
      </Box>
      <Box display="flex" gap="5px" mt="5px" justifyContent="space-between">
        <Box display="flex" gap="5px">
          <Image src={InfoIcon.src} alt="" />
          <Text className="label">Tx Fee</Text>
        </Box>
        <Text>{estFee}</Text>
      </Box>
    </StyledTransactionFee>
  );
};

export default TransactionFee;
