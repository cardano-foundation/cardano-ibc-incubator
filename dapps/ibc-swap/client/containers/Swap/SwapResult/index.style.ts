import styled from '@emotion/styled';
import { COLOR } from '@/styles/color';
import { Box, BoxProps, Button } from '@chakra-ui/react';

const StyledWrapContainer = styled.div`
  display: flex;
  justify-content: center;
  position: relative;
`;

const StyledTransferContainer = styled.div`
  position: fixed;
  top: 152px;
  width: 484px;
  border-radius: 16px;
  border-width: 1px;
  padding: 24px 24px 28px 24px;
  gap: 16px;
  box-shadow: 1px 1px 2px 0px #fcfcfc1f inset;
  border: 1px solid #ffffff0d;
  background: ${COLOR.neutral_6};
`;

interface StyledSwitchNetworkProps extends BoxProps {
  disabled?: boolean;
}

const StyledSwitchNetwork = styled(Box)<StyledSwitchNetworkProps>`
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
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
`;

const StyledTransferDetailButton = styled(Button)`
  width: 100%;
  height: 48px;
  padding: 12px 24px 12px 24px;
  gap: 8px;
  border-radius: 12px;
  opacity: 0px;
`;

const StyledTransferFromToBox = styled.div`
  width: 100%;
  min-height: 66px;
  padding: 10px 16px 10px 16px;
  gap: 4px;
  border-radius: 10px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
`;

const StyledTransferCalculatorBox = styled.div`
  display: inline-grid;
  margin-top: 16px;
  width: 100%;
  height: 70px;
  padding: 9px 16px 11px 16px;
  gap: 4px;
  border-radius: 10px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
`;

const StyledTimerBox = styled.div`
  position: absolute;
  width: 92px;
  height: 92px;
  top: -25%;
  left: 50%;
  translate: -50% 35%;
  gap: 0px;
  opacity: 0px;
  z-index: 10;
  background: ${COLOR.neutral_6};
  border-radius: 100%;
  display: flex;
  justify-content: center;
  box-shadow: 0px 2px 1px 0px #fcfcfc1f inset;
`;

export {
  StyledSwitchNetwork,
  StyledTimerBox,
  StyledTransferCalculatorBox,
  StyledTransferContainer,
  StyledTransferDetailButton,
  StyledTransferFromToBox,
  StyledWrapContainer,
};
