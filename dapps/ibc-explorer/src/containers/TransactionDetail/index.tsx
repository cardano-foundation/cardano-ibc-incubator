import { Box, Divider, Grid, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { HeaderTitle } from '@src/components/HeaderTitle';
import DoubleArrowIcon from '@src/components/DoubleArrowIcon';
import TransferIcon from '@src/assets/logo/transfer-icon.svg';
import ReceiveIcon from '@src/assets/logo/receive-icon.svg';
import AcknowledgeIcon from '@src/assets/logo/acknowledge-icon.svg';
import SendReceiveSection from './SendReceiveSection';
import TokenAvatar from './TokenAvatar';
import AddressInfoCard from './AddressInfo';
import Relayer from './Relayer';
import TransferInfo from './TransferInfo';
import { StyledBasicInfo, StyledWrapperCointainer } from './index.style';

const TransactionDetail = () => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('md'));
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      bgcolor="#F5F7F9"
      paddingY={4}
      paddingX={matches ? 2 : undefined}
    >
      <StyledWrapperCointainer>
        <Box mb={3}>
          <HeaderTitle title="IBC Packet Details" status="processing" />
        </Box>
        <StyledBasicInfo>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Basic Info
          </Typography>
          <Divider />
          <Box marginTop="12px">
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
          <Grid
            container
            display="flex"
            justifyContent="space-between"
            gap="10px"
            paddingY="25px"
          >
            <Grid item xs={12} md={3.7}>
              <AddressInfoCard />
            </Grid>
            <Grid item xs={12} md={0.5} display="flex" justifyContent="center">
              <DoubleArrowIcon
                color="green"
                mt="30px"
                style={{ transform: matches ? 'rotate(90deg)' : undefined }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <Relayer />
            </Grid>
            <Grid item xs={12} md={0.5} display="flex" justifyContent="center">
              <DoubleArrowIcon
                color="brown"
                mt="30px"
                style={{ transform: matches ? 'rotate(90deg)' : undefined }}
              />
            </Grid>
            <Grid item xs={12} md={3.7}>
              <AddressInfoCard fromOrTo="To" />
            </Grid>
          </Grid>
        </StyledBasicInfo>
      </StyledWrapperCointainer>

      <StyledWrapperCointainer>
        <StyledBasicInfo>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Basic Info
          </Typography>
          <Divider />
          <TransferInfo title="Transfer" tag="From" icon={TransferIcon} />
          <TransferInfo title="Receive" tag="To" icon={ReceiveIcon} />
          <TransferInfo
            title="Acknowledge"
            tag="Result"
            icon={AcknowledgeIcon}
          />
        </StyledBasicInfo>
      </StyledWrapperCointainer>
    </Box>
  );
};

export default TransactionDetail;
