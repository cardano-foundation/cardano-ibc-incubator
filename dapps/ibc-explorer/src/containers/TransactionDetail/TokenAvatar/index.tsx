import { Box, Typography } from '@mui/material';
import TokenImage from '@src/assets/images/token-fake.png';

const TokenAvatar = () => {
  return (
    <Box
      width="180px"
      height="170px"
      border="1px solid #E9ECF1"
      borderRadius="20px"
      overflow="hidden"
    >
      <Box display="flex" justifyContent="center" paddingY="20px">
        <img src={TokenImage} alt="token-image" width="96px" height="auto" />
      </Box>
      <Box bgcolor="#F5F7F9" paddingY="5px">
        <Typography textAlign="center" fontWeight={600}>
          TIA
        </Typography>
      </Box>
    </Box>
  );
};

export default TokenAvatar;
