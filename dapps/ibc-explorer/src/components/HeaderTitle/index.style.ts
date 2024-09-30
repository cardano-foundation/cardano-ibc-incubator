import styled from '@emotion/styled';
import { Box } from '@mui/material';

const StyledStatusBox = styled(Box)`
  display: flex;
  padding: 4px 12px 4px 10px;
  gap: 6px;
  border-radius: 40px;
  opacity: 0px;
  align-items: center;
`;

const StyledMessageBox = styled(Box)`
  margin-top: 24px;
  padding: 14px 12px 14px 20px;
  gap: 20px;
  border-radius: 10px;
  opacity: 0px;
`;

export { StyledStatusBox, StyledMessageBox };
