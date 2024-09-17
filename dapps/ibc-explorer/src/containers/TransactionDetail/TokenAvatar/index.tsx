import { Box, Typography } from '@mui/material';
import { CARDANO_LOVELACE_HEX } from '@src/configs/customChainInfo';

const TokenAvatar = ({
  tokenName,
  tokenImg,
}: {
  tokenName: string;
  tokenImg: string;
}) => {
  const tokenPath = tokenName.split('/');
  let tokenNameDisplay = tokenPath.reverse()?.[0] || tokenName;
  if (tokenNameDisplay === CARDANO_LOVELACE_HEX) {
    tokenNameDisplay = 'lovelace';
  }
  return (
    <Box
      width="180px"
      border="1px solid #E9ECF1"
      borderRadius="20px"
      overflow="hidden"
    >
      <Box display="flex" justifyContent="center" paddingY="20px">
        <img src={tokenImg} alt="token-image" width="96px" height="auto" />
      </Box>
      <Box bgcolor="#F5F7F9" paddingY="5px">
        <Typography textAlign="center" fontWeight={600}>
          {`${tokenNameDisplay.toUpperCase()} ${
            tokenPath.length > 1 ? ' (IBC)' : ''
          }`}
        </Typography>
      </Box>
    </Box>
  );
};

export default TokenAvatar;
