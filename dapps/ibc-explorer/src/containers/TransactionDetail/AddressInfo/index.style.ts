import styled from '@emotion/styled';
import { Chip } from '@mui/material';

const StyledChip = styled(Chip)`
  margin-top: 10px;
  background-color: #e8f3ff;
  border: none;
  .MuiChip-deleteIcon {
    color: #4a90e2;
    &:hover {
      color: #4a90e2;
    }
  }
`;

export { StyledChip };
