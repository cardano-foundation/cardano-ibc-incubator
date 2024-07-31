import { Heading } from '@chakra-ui/react';
import { StyledTransferContainer, StyledWrapContainer } from './index.style';

export const TransferResult = () => {
  return (
    <StyledWrapContainer>
      <StyledTransferContainer>
        <Heading fontSize={20} lineHeight="28px" fontWeight={700}>
          Transfer
        </Heading>
      </StyledTransferContainer>
    </StyledWrapContainer>
  );
};
