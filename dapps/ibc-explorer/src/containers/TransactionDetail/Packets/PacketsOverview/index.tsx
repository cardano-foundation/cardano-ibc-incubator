import { Box, Grid, Typography } from '@mui/material';
import TokenAvatar from '@src/containers/TransactionDetail/TokenAvatar';
import SendReceiveSection from '@src/containers/TransactionDetail/SendReceiveSection';

const PacketsOverview = () => {
  return (
    <Box marginTop="12px" marginBottom="25px">
      <Typography fontWeight="700">Token</Typography>
      <Grid container mt="10px" spacing={3}>
        <Grid item xs={12} md={3}>
          <TokenAvatar />
        </Grid>
        <Grid item xs={12} md={9}>
          <SendReceiveSection />
        </Grid>
      </Grid>
    </Box>
  );
};
export default PacketsOverview;
