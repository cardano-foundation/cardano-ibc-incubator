import React from 'react';
import { Box, Image, Spinner, Text } from '@chakra-ui/react';

import InfoIcon from '@/assets/icons/info.svg';

import StyledTransactionFee from './index.style';

const TransactionFee = ({
  minimumReceived,
  estFee,
  isLoading = false,
}: {
  minimumReceived: string;
  estFee: string;
  isLoading?: boolean;
}) => {
  const displayMinimumReceived = isLoading
    ? 'Estimating route...'
    : minimumReceived;
  const displayFee = isLoading ? 'Estimating fee...' : estFee;

  return (
    <StyledTransactionFee>
      <Box display="flex" justifyContent="space-between">
        <Box display="flex" gap="5px">
          <Image src={InfoIcon.src} alt="" />
          <Text className="label">Minimum receive</Text>
        </Box>
        <Box display="flex" alignItems="center" gap="8px">
          {isLoading && <Spinner size="xs" />}
          <Text>{displayMinimumReceived}</Text>
        </Box>
      </Box>
      <Box display="flex" gap="5px" mt="5px" justifyContent="space-between">
        <Box display="flex" gap="5px">
          <Image src={InfoIcon.src} alt="" />
          <Text className="label">Tx Fee</Text>
        </Box>
        <Text>{displayFee}</Text>
      </Box>
    </StyledTransactionFee>
  );
};

export default TransactionFee;
