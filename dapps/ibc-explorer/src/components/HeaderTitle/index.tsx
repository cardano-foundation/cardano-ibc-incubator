import { Box, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DoneIcon from '@mui/icons-material/Done';
import ClearIcon from '@mui/icons-material/Clear';
import { TX_STATUS } from '@src/constants';
import { COLOR } from '@src/styles/color';

import { StyledMessageBox, StyledStatusBox } from './index.style';

type HeaderTitleProps = {
  title: string;
  status?: string;
  message?: string;
};

export const HeaderTitle = ({ title, status, message }: HeaderTitleProps) => {
  const showStatus = () => {
    switch (status) {
      case TX_STATUS.PROCESSING:
        return (
          <StyledStatusBox bgcolor={COLOR.warning}>
            <AccessTimeIcon style={{ width: '20px', height: '20px' }} />
            <Typography
              fontSize={12}
              fontWeight={600}
              lineHeight="18px"
              color={COLOR.neutral_1}
            >
              Processing
            </Typography>
          </StyledStatusBox>
        );
      case TX_STATUS.SUCCESS:
        return (
          <StyledStatusBox bgcolor={COLOR.success}>
            <DoneIcon
              style={{ width: '20px', height: '20px' }}
              htmlColor={COLOR.white}
            />
            <Typography
              fontSize={12}
              fontWeight={600}
              lineHeight="18px"
              color={COLOR.white}
            >
              Succes
            </Typography>
          </StyledStatusBox>
        );
      case TX_STATUS.FAILED:
        return (
          <StyledStatusBox bgcolor={COLOR.error}>
            <ClearIcon
              style={{ width: '20px', height: '20px' }}
              htmlColor={COLOR.white}
            />
            <Typography
              fontSize={12}
              fontWeight={600}
              lineHeight="18px"
              color={COLOR.white}
            >
              Failed
            </Typography>
          </StyledStatusBox>
        );
      default:
        return null;
    }
  };

  const showMessage = () => {
    if (!message) return null;
    switch (status) {
      case TX_STATUS.FAILED:
        return (
          <StyledMessageBox bgcolor="rgba(196, 39, 18, 0.1)">
            <Typography
              fontSize={16}
              fontWeight={600}
              lineHeight="22px"
              color={COLOR.error}
            >
              {message}
            </Typography>
          </StyledMessageBox>
        );
      default:
        return null;
    }
  };

  return (
    <Box mb={2}>
      <Box display="flex" gap={2} alignItems="center">
        <Typography fontSize={20} fontWeight={700} lineHeight="28px">
          {title}
        </Typography>
        {showStatus()}
      </Box>
      {showMessage()}
    </Box>
  );
};
