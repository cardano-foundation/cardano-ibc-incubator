import { Box, Link, TableCell, Typography } from '@mui/material';
import { COLOR } from '@src/styles/color';
import { TransactionType } from '@src/types/transaction';
import { formatUnixTimestamp, truncateString } from '@src/utils/string';
import { TX_STATUS } from '@src/constants';
import { useHistory } from 'react-router-dom';

import { StyledContentTableRow } from './index.style';

type TableRowItemProps = {
  rowData: TransactionType;
};

export const TableRowItem = ({ rowData }: TableRowItemProps) => {
  const history = useHistory();

  const getStatusColor = () => {
    switch (rowData.status) {
      case TX_STATUS.FAILED:
        return COLOR.error;
      case TX_STATUS.PROCESSING:
        return COLOR.warning;
      case TX_STATUS.SUCCESS:
        return COLOR.success;
      default:
        return COLOR.error;
    }
  };

  const handleClick = (
    event: React.MouseEvent<HTMLTableRowElement, MouseEvent>,
  ) => {
    event.preventDefault();
    history.push(`/${rowData.fromTxHash}`);
  };

  return (
    <StyledContentTableRow key={rowData.fromTxHash} onClick={handleClick}>
      <TableCell>
        <Link href="./#" underline="hover">
          <Typography>{truncateString(rowData.fromTxHash, 4, 4)}</Typography>
        </Link>
      </TableCell>
      <TableCell>
        <Typography>{truncateString(rowData.fromAddress, 6, 6)}</Typography>
      </TableCell>
      <TableCell>
        <Box>
          <Box display="flex" alignItems="center" gap={2}>
            <img
              width={24}
              height={24}
              src={rowData.fromNetworkLogo}
              alt="fromNetworkLogo"
            />
          </Box>
        </Box>
      </TableCell>
      <TableCell>
        <Box>
          <Typography
            color={getStatusColor()}
            sx={{ textTransform: 'capitalize' }}
          >
            {rowData.status}
          </Typography>
        </Box>
      </TableCell>
      <TableCell>
        <Typography>{truncateString(rowData.toAddress, 6, 6)}</Typography>
      </TableCell>
      <TableCell>
        {rowData.toTxHash?.length ? (
          <Link href="./#" underline="hover">
            <Typography>{truncateString(rowData.toTxHash, 4, 4)}</Typography>
          </Link>
        ) : (
          <Typography>--</Typography>
        )}
      </TableCell>
      <TableCell>
        <Typography>{formatUnixTimestamp(rowData.createTime)}</Typography>
      </TableCell>
      <TableCell>
        <Typography>{formatUnixTimestamp(rowData.endTime)}</Typography>
      </TableCell>
    </StyledContentTableRow>
  );
};
