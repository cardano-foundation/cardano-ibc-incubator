import { Box, BoxProps } from '@mui/material';
import DoubleArrowGreenIcon from '@src/assets/images/double-arrow-green.png';
import DoubleArrowBrownIcon from '@src/assets/images/double-arrow-brown.png';

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

export default DoubleArrowIcon;
