import styled from '@emotion/styled';
import { COLOR } from '@/styles/color';

const StyledWrapContainer = styled.div`
  display: flex;
  justify-content: center;
  position: relative;
`;

const StyledTransferContainer = styled.div`
  position: fixed;
  top: 152px;
  width: 484px;
  height: 424px;
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
  height: 56px;
  position: relative;
  display: flex;
  border-radius: 10px;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
`;

const StyledSelectBox = styled.div`
  padding: 16px;
  background: ${COLOR.neutral_5};
  display: flex;
  width: 50%;
  justify-content: space-between;
  align-items: center;
  border-radius: 10px;
  cursor: pointer;

  :hover {
    background: ${COLOR.neutral_4};
  }
`;

const StyledSwitchNetwork = styled.div`
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
  top: 13%;
  left: 50%;
  transform: translateX(-50%);

  :hover {
    background: ${COLOR.neutral_4};
  }
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

const StyledSelectTokenBox = styled.div`
  display: flex;
  justify-content: space-between;
  bottom: 0;
  align-items: center;
  gap: 16px;
  cursor: pointer;
`;

const StyledTransferButton = styled.button`
  width: 100%;
  margin-top: 16px;
  height: 48px;
  padding: 12px 24px 12px 24px;
  gap: 8px;
  border-radius: 12px;
  opacity: 0px;
  background: ${COLOR.neutral_4};

  :disabled {
    background: ${COLOR.neutral_4};
  }
`;

const StyledNetworkBox = styled.div`
  width: 320px;
  height: 100%;
  gap: 16px;
  border-radius: 12px;
  opacity: 0px;
  background: #0e0e124d;
`;

const StyledNetworkBoxHeader = styled.div`
  width: 100%;
  height: 56px;
  padding: 14px 12px 14px 12px;
  gap: 16px;
  border-radius: 12px 12px 0px 0px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
  display: flex;
  justify-content: center;
`;

const StyledTokenBox = styled.div`
  width: 416px;
  height: 100%;
  padding: 0px 0px 16px 0px;
  gap: 30px;
  opacity: 0px;
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
};
