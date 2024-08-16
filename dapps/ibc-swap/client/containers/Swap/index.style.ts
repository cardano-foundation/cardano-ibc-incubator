import { COLOR } from '@/styles/color';
import { Box } from '@chakra-ui/react';
import styled from '@emotion/styled';

export const StyledWrapContainer = styled.div`
  display: flex;
  justify-content: center;
  position: relative;
`;

const StyledSwap = styled.div`
  position: fixed;
  top: 152px;
  width: 484px;
  background: ${COLOR.neutral_6};
  border-radius: 16px;
  // margin: 20px auto;
  padding: 24px 24px 28px 24px;
  gap: 16px;
  border-radius: 16px;
  opacity: 0px;
  border: 1px solid #ffffff0d;
  box-shadow: 1px 1px 2px 0px #fcfcfc1f inset;

  .title {
    font-size: 20px;
  }

  .swap-button {
    color: ${COLOR.neutral_1};
    width: 100%;
    margin-top: 16px;
    height: 48px;
    padding: 12px 24px 12px 24px;
    gap: 8px;
    border-radius: 12px;
    opacity: 0.8;
    background: ${COLOR.primary};
    box-shadow: 2px 2px 3px 0px #fcfcfc66 inset;

    :hover {
      opacity: 1;
      background: ${COLOR.primary};
    }

    :disabled {
      background: ${COLOR.neutral_4};
      box-shadow: none;
      cursor: not-allowed;
      opacity: 1;
    }
  }

  .destination-address {
    background: #323236;
    border: none;
    margin-top: 15px;
  }
`;

export const StyledSwitchNetwork = styled(Box)`
  width: 36px;
  height: 36px;
  padding: 8px;
  gap: 10px;
  border-radius: 8px;
  border-width: 1px;
  opacity: 0px;
  background: #26262a;
  border: 1px solid #47474b;
  box-shadow: 0px 0px 8px 0px #00000040;
  cursor: pointer;
  position: absolute;
  margin-top: 10px;
  left: 50%;
  translate: -50% -50%;
  transform: rotate(90deg);
`;

export const StyledSwapButton = styled.button`
  width: 100%;
  margin-top: 16px;
  height: 48px;
  padding: 12px 24px 12px 24px;
  gap: 8px;
  border-radius: 12px;
  opacity: 0.8;
  background: ${COLOR.primary};
  box-shadow: 2px 2px 3px 0px #fcfcfc66 inset;

  :hover {
    opacity: 1;
  }

  :disabled {
    background: ${COLOR.neutral_4};
    box-shadow: none;
    cursor: not-allowed;
    opacity: 1;
  }
`;

export default StyledSwap;
