import { Box, Typography } from '@mui/material';

const TokenAvatar = ({
  tokenName,
  tokenImg,
}: {
  tokenName: string;
  tokenImg: string;
}) => {
  return (
    <Box
      width="180px"
      height="170px"
      border="1px solid #E9ECF1"
      borderRadius="20px"
      overflow="hidden"
    >
      <Box display="flex" justifyContent="center" paddingY="20px">
        <img src={tokenImg} alt="token-image" width="96px" height="auto" />
      </Box>
      <Box bgcolor="#F5F7F9" paddingY="5px">
        <Typography textAlign="center" fontWeight={600}>
          {tokenName.toUpperCase()}
        </Typography>
      </Box>
    </Box>
  );
};

export default TokenAvatar;
