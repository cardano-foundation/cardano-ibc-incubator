import styled from '@emotion/styled';
import { TableCell, TableRow } from '@mui/material';
import { COLOR } from '@src/styles/color';

const StyledHeadTableRow = styled(TableRow)`
  height: 50px;
  padding: 15px 20px 15px 20px;
  gap: 0px;
  border-radius: 10px 10px 0px 0px;
  justify: space-between;
  opacity: 0px;
  background: ${COLOR.neutral_6};

  .table-head-title {
    font-size: 14px;
    font-weight: 700;
    line-height: 20px;
    text-align: left;
    color: ${COLOR.neutral_2};
  }
`;

const StyledHeadTableCell = styled(TableCell)`
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
  text-align: left;
  color: ${COLOR.neutral_2};
`;

const StyledContentTableRow = styled(TableRow)`
  height: 72px;
  padding: 14px 20px 14px 20px;
  gap: 0px;
  border: 0px 0px 1px 0px;
  opacity: 0px;
  cursor: pointer;

  :hover {
    background-color: ${COLOR.neutral_6};
  }

  .token-denom {
    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    color: ${COLOR.neutral_1};
  }

  a p {
    font-weight: 600;
    color: #2767fc;
  }

  p {
    font-size: 14px;
    font-weight: 400;
    line-height: 20px;
  }
`;

export { StyledHeadTableRow, StyledHeadTableCell, StyledContentTableRow };
