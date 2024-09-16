import { useTheme } from '@mui/material/styles';
import { Box, Typography, Grid, useMediaQuery } from '@mui/material';
import { shortenAddress } from '@src/utils/string';

const SendReceiveSection = ({
  amount,
  sendToken,
  sendTokenPath,
  receiveToken,
  receiveTokenPath,
}: {
  amount: string;
  sendToken: string;
  sendTokenPath: string;
  receiveToken: string;
  receiveTokenPath: string;
}) => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('md'));

  const data = [
    {
      label: 'Amount',
      value: amount,
    },
    {
      label: 'Send Token Denom',
      value: sendToken,
    },
    {
      label: 'Send Token Path',
      value: sendTokenPath,
    },
    {
      label: 'Received Token Denom',
      value: receiveToken,
    },
    {
      label: 'Received Token Path',
      value: receiveTokenPath,
    },
  ];
  return (
    <Box flex="1">
      <Grid container spacing={2}>
        {data.map((dt) => {
          return (
            <Grid item xs={12} key={JSON.stringify(dt)}>
              <Box display="flex">
                <Typography
                  fontSize="14px"
                  width={matches ? '160px' : '230px'}
                  fontWeight="600"
                  textAlign="justify"
                >
                  {dt.label}
                </Typography>
                <Box maxWidth={matches ? '100px' : undefined}>
                  {matches &&
                  ['Send Token Denom', 'Received Token Denom'].includes(
                    dt.label,
                  ) ? (
                    <Typography fontSize="14px">
                      {shortenAddress(dt.value, 8)}
                    </Typography>
                  ) : (
                    <Typography fontSize="14px">{dt.value}</Typography>
                  )}
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

export default SendReceiveSection;
