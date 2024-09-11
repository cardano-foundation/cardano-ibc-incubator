import styled from '@emotion/styled';
import { Grid } from '@mui/material';
import { COLOR } from '@src/styles/color';

const StyledStatusBox = styled(Grid)`
  gap: 4px;
  display: flex;
  align-items: center;

  .status-label {
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
    color: ${COLOR.neutral_2};
  }
`;

export { StyledStatusBox };
