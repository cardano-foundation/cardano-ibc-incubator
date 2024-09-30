import styled from '@emotion/styled';
import { Box } from '@mui/material';
import { COLOR } from '@src/styles/color';

const StyledWrapper = styled.div`
  min-width: 130px;
  padding: 6px 0px 6px 0px;
  gap: 0px;
  border-radius: 8px 0px 0px 0px;
  opacity: 0px;
  background: #ffffff;
  box-shadow: 0px 0px 16px 0px #11142d17;
`;

const StyledStatusItem = styled(Box)`
  display: flex;
  height: 46px;
  padding: 0px 16px;
  gap: 8px;
  opacity: 0px;
  align-items: center;

  &.selected {
    background: #2767fc;
    color: ${COLOR.white};
  }

  :hover {
    background: #2767fc;
    color: ${COLOR.white};
  }
`;

export { StyledWrapper, StyledStatusItem };
