import { Fragment } from 'react';
import { TX_STATUS } from '@src/constants';
import { Typography } from '@mui/material';
import { StatusType } from '@src/types/transaction';

import { StyledStatusItem, StyledWrapper } from './index.style';

const statusList = [
  {
    label: 'All Status',
    value: '',
  },
  {
    label: 'Success',
    value: TX_STATUS.SUCCESS,
  },
  {
    label: 'Processing',
    value: TX_STATUS.PROCESSING,
  },
  {
    label: 'Failed',
    value: TX_STATUS.FAILED,
  },
];

type StatusListBoxProps = {
  selectedStatus: StatusType;
  // eslint-disable-next-line no-unused-vars
  handleClick: (status: StatusType) => void;
};

export const StatusListBox = ({
  selectedStatus,
  handleClick,
}: StatusListBoxProps) => {
  return (
    <StyledWrapper>
      {statusList.map((status) => (
        <Fragment key={status.value}>
          <StyledStatusItem
            sx={{
              '&:hover': {
                cursor: 'pointer',
              },
            }}
            className={selectedStatus.value === status.value ? 'selected' : ''}
            onClick={() => handleClick(status)}
          >
            <Typography>{status.label}</Typography>
          </StyledStatusItem>
        </Fragment>
      ))}
    </StyledWrapper>
  );
};
