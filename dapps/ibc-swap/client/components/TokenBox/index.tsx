import React from 'react';
import { Box, Button, Input, Text } from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import StyledTokenBox from './index.style';

type TokenBoxProps = {
  handleClick: () => void;
};

const TokenBox = ({ handleClick }: TokenBoxProps) => {
  return (
    <StyledTokenBox>
      <Box display="flex" justifyContent="space-between">
        <Text className="label">From token</Text>
        <Text className="balance">Balance: 0</Text>
      </Box>
      <Box display="flex" justifyContent="space-between" marginTop="5px">
        <Box display="flex" alignItems="center">
          <Button
            rightIcon={<FaChevronDown />}
            colorScheme="white"
            variant="outline"
            border="none"
            padding="0"
            fontWeight="700"
            onClick={handleClick}
          >
            Select Network
          </Button>
        </Box>
        <Box>
          <Input
            className="input-quantity"
            variant="unstyled"
            textAlign="right"
            placeholder="0"
          />
        </Box>
      </Box>
    </StyledTokenBox>
  );
};

export default TokenBox;
