import styled from '@emotion/styled';
import { Box, Button } from '@mui/material';
import { COLOR } from '@src/styles/color';

const StyledChainItemBox = styled(Box)`
  margin-bottom: 8px;
  padding: 8px 16px 8px 16px;
  gap: 8px;
  border-radius: 8px;
  opacity: 0px;
  border: 1px solid #e9ecf1;
  position: relative;

  &.selected {
    border: 1.2px solid #2767fc;
    background: #ebf0fd;
  }

  :hover {
    border: 1.2px solid #2767fc;
    background: #ebf0fd;
  }
`;

const StyledChainListBox = styled(Box)`
  margin-top: 6px;
  max-height: 240px;
  overflow-y: scroll;
`;

const StyledConfirmedButton = styled(Button)`
  width: 100%;
  padding: 10px 18px 10px 18px;
  gap: 8px;
  border-radius: 10px;
  opacity: 0px;
  text-transform: none;
`;

const StyledWrapper = {
  maxWidth: '320px',
  maxHeight: '420px',
  padding: '16px',
  gap: '20px',
  borderRadius: '12px',
  opacity: '0px',
  background: COLOR.white,
  boxShadow: '0px 8px 24px 2px rgba(17, 20, 45, 0.09)',
};

const StyledSelectedLabel = styled(Box)`
  border-radius: 16px;
  padding: 1px 8px;
  white-space: nowrap;
  z-index: 1;
  background: ${COLOR.info};
  display: flex;
  align-items: center;
`;

export {
  StyledWrapper,
  StyledChainItemBox,
  StyledChainListBox,
  StyledConfirmedButton,
  StyledSelectedLabel,
};
