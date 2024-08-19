import styled from '@emotion/styled';
import { COLOR } from '@/styles/color';
import { Box, BoxProps, Button, Text } from '@chakra-ui/react';

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

const StyledNetworkSection = styled.div`
  margin-top: 16px;
  position: relative;
  display: flex;
  border-radius: 10px;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
`;

interface StyledSelectBoxProps extends BoxProps {
  disabled?: boolean;
}

const StyledSelectBox = styled.div<StyledSelectBoxProps>`
  height: 64px;
  padding: 16px;
  background: ${COLOR.neutral_5};
  display: flex;
  width: 50%;
  justify-content: space-between;
  align-items: center;
  border-radius: 10px;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};

  :hover {
    background: ${(props) =>
      props.disabled ? COLOR.neutral_5 : COLOR.neutral_4};
  }
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

const StyledNetworkName = styled(Text)`
  font-size: 16px;
  line-height: 22px;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 118px;
`;

const StyledTokenSection = styled.div`
  margin-top: 16px;
  width: 100%;
  height: 108px;
  padding: 20px 16px 16px 16px;
  gap: 0px;
  border-radius: 11px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
  align-items: stretch;
`;

interface StyledSelectTokenBoxProps extends BoxProps {
  disabled?: boolean;
}

const StyledSelectTokenBox = styled.div<StyledSelectTokenBoxProps>`
  display: flex;
  justify-content: space-between;
  bottom: 0;
  align-items: center;
  gap: 16px;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
`;

const StyledTransferButton = styled.button`
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

interface StyledNetworkBoxProps extends BoxProps {
  isActive?: boolean;
}

const StyledNetworkBox = styled.div<StyledNetworkBoxProps>`
  width: 320px;
  height: 100%;
  gap: 16px;
  border-radius: 12px;
  opacity: 0px;
  background: #0e0e124d;
  border: ${(props) => props.isActive && `1px solid ${COLOR.success}`};
`;

interface StyledNetworkBoxHeaderProps extends BoxProps {
  isActive?: boolean;
}

const StyledNetworkBoxHeader = styled.div<StyledNetworkBoxHeaderProps>`
  width: 100%;
  height: 56px;
  padding: 14px 12px 14px 12px;
  gap: 16px;
  border-radius: 12px 12px 0px 0px;
  opacity: 0px;
  background: ${(props) => (props.isActive ? '#4DFED314' : COLOR.neutral_5)};
  display: flex;
  justify-content: center;
  align-items: center;
`;

const StyledTokenBox = styled.div`
  width: 416px;
  height: 100%;
  padding: 0px 0px 16px 0px;
  gap: 30px;
  opacity: 0px;
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
  StyledWrapContainer,
  StyledTransferContainer,
  StyledNetworkSection,
  StyledSelectBox,
  StyledSwitchNetwork,
  StyledTokenSection,
  StyledTransferButton,
  StyledNetworkBox,
  StyledNetworkBoxHeader,
  StyledSelectTokenBox,
  StyledTokenBox,
  StyledTransferDetailButton,
  StyledTransferFromToBox,
  StyledTransferCalculatorBox,
  StyledTimerBox,
  StyledNetworkName,
};
