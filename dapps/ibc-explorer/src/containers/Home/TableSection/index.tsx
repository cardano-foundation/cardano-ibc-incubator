import { Fragment } from 'react';

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import Paper from '@mui/material/Paper';
import {
  Box,
  Pagination,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import { TransactionType } from '@src/types/transaction';
import { TableRowItem } from './TableRow';

import { StyledHeadTableCell, StyledHeadTableRow } from './index.style';

const headTitleLabels = [
  'From TxHash',
  'From',
  'From Chain',
  'Status',
  'To',
  'To TxHash',
  'Create Time',
  'End Time',
];

type TableSectionProps = {
  data: TransactionType[];
  pagination: {
    page: number;
    rowsPerPage: number;
    count: number;
  };
  setPagination: React.Dispatch<
    React.SetStateAction<{
      page: number;
      rowsPerPage: number;
      count: number;
    }>
  >;
};

export const TableSection = ({
  data,
  pagination,
  setPagination,
}: TableSectionProps) => {
  const renderTableHeader = () => {
    return headTitleLabels.map((title) => (
      <Fragment key={title}>
        <StyledHeadTableCell>
          <Typography className="table-head-title">{title}</Typography>
        </StyledHeadTableCell>
      </Fragment>
    ));
  };

  const renderNoDataFound = () => {
    return (
      <TableRow>
        <TableCell align="center" colSpan={8}>
          <Box display="flex" justifyContent="center" alignItems="center">
            <Typography fontWeight={600}>No Data Found</Typography>
          </Box>
        </TableCell>
      </TableRow>
    );
  };

  const renderTableRowItem = (tx: TransactionType, index: number) => {
    return (
      <Fragment key={`${JSON.stringify(tx)}_${index}`}>
        <TableRowItem rowData={tx} />
      </Fragment>
    );
  };

  return (
    <Paper sx={{ width: '100%', marginTop: 2 }}>
      <TableContainer>
        <Table>
          <TableHead>
            <StyledHeadTableRow>{renderTableHeader()}</StyledHeadTableRow>
          </TableHead>
          <TableBody>
            {data.length > 0
              ? data.map((tx, index) => renderTableRowItem(tx, index))
              : renderNoDataFound()}
          </TableBody>
        </Table>
      </TableContainer>
      <Box display="flex" justifyContent="center" alignItems="center" py={2}>
        {!!pagination.count && (
          <Pagination
            onChange={(e, page) => {
              setPagination((prev) => ({ ...prev, page }));
            }}
            sx={{
              alignItems: 'center',
            }}
            count={pagination.count}
            color="primary"
            shape="rounded"
          />
        )}
      </Box>
    </Paper>
  );
};
