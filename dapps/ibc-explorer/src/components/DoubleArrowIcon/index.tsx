import { Box, BoxProps, Grid, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DoubleArrowGreenIcon from '@src/assets/images/double-arrow-green.png';
import DoubleArrowBrownIcon from '@src/assets/images/double-arrow-brown.png';
import DoubleArrowRedIcon from '@src/assets/images/double-arrow-red.png';
import { TX_STATUS } from '@src/constants';

interface DoubleArrowIconProps extends BoxProps {
  color: string;
}

const DoubleArrowIcon = ({ color, ...props }: DoubleArrowIconProps) => {
  const renderIcon = () => {
    switch (color) {
      case 'green':
        return DoubleArrowGreenIcon;
      case 'brown':
        return DoubleArrowBrownIcon;
      case 'red':
        return DoubleArrowRedIcon;
      default:
        return DoubleArrowGreenIcon;
    }
  };

  const IconComponent = renderIcon();

  return (
    <Box display="flex" alignItems="center" {...props}>
      <img height="34px" src={IconComponent} alt="arrow-icon" />
    </Box>
  );
};
export const ArrowStatusIconGrid = ({ status }: { status: string }) => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('md'));
  const colorStatus = () => {
    switch (status) {
      case TX_STATUS.SUCCESS:
        return 'green';
      case TX_STATUS.PROCESSING:
        return 'brown';
      case TX_STATUS.FAILED:
        return 'red';
      default:
        return 'green';
    }
  };
  return (
    <Grid item xs={12} md={0.5} display="flex" justifyContent="center">
      <DoubleArrowIcon
        color={colorStatus()}
        style={{ transform: matches ? 'rotate(90deg)' : undefined }}
      />
    </Grid>
  );
};

export default DoubleArrowIcon;
