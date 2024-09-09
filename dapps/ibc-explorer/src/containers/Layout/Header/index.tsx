import { Box } from '@mui/material';
import { useHistory } from 'react-router-dom';
import CardanoLogo from '@src/assets/logo/cardano-logo-blue.svg';
import { StyledHeaderWrapper } from './index.style';

export const Header = () => {
  const history = useHistory();

  const handleClick = () => {
    history.push('/');
  };

  return (
    <StyledHeaderWrapper>
      <Box
        onClick={handleClick}
        sx={{
          '&:hover': {
            cursor: 'pointer',
          },
        }}
      >
        <img height={32} src={CardanoLogo} alt="Logo" />
      </Box>
    </StyledHeaderWrapper>
  );
};
