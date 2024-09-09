import { Box, Typography, Grid } from '@mui/material';

const SendReceiveSection = () => {
  const data = [
    {
      label: 'Amount',
      value: '497.227868 TIA',
    },
    {
      label: 'Send Token Path',
      value: 'transfer/channel-162/utia',
    },
    {
      label: 'Send Token Denom',
      value:
        'ibc/3F384F35F3694B66E13C23107C84B6458D2B96296B7EC680EA778BA758A4801',
    },
    {
      label: 'Received Token Path',
      value: '--',
    },
    {
      label: 'Received Token Denom',
      value: '--',
    },
  ];
  return (
    <Box flex="1">
      <Grid container spacing={2}>
        {data.map((dt) => {
          return (
            <Grid item xs={12}>
              <Box display="flex">
                <Typography fontSize="14px" width="230px" fontWeight="600">
                  {dt.label}
                </Typography>
                <Typography fontSize="14px">{dt.value}</Typography>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

export default SendReceiveSection;
